import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { X509Certificate } from "node:crypto";

/**
 * Cliente HTTP para las webs de DIGEMID/MINSA.
 *
 * Los servidores de minsa.gob.pe a veces envían la cadena de certificados incompleta (sin el certificado
 * intermedio). Los navegadores la completan descargando el intermedio desde la dirección «CA Issuers» (AIA)
 * del propio certificado; Node no lo hace y respondía «unable to verify the first certificate».
 * Aquí se hace lo mismo que el navegador: se descarga el intermedio indicado por el certificado y se repite
 * la petición CON verificación completa contra las raíces de confianza de Node. La verificación nunca se
 * desactiva. Si hiciera falta, también se pueden añadir certificados en la variable DIGEMID_CA_PEM.
 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const ERRORES_CADENA = new Set(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_GET_ISSUER_CERT"]);

export interface Respuesta { status: number; texto: string; url: string }
export interface Opciones { metodo?: "GET" | "POST"; cuerpo?: unknown; headers?: Record<string, string>; timeoutMs?: number }

const intermedios = new Map<string, string[]>(); // host → PEM adicionales (caché del proceso)
const extraEnv = process.env.DIGEMID_CA_PEM ? [process.env.DIGEMID_CA_PEM.replace(/\\n/g, "\n")] : [];

function pedir(url: string, o: Opciones, ca?: string[], saltos = 0): Promise<Respuesta> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const cuerpo = o.cuerpo === undefined ? undefined : typeof o.cuerpo === "string" ? o.cuerpo : JSON.stringify(o.cuerpo);
    const headers: Record<string, string> = { "User-Agent": UA, "Accept-Language": "es-PE,es;q=0.9", Accept: "*/*", ...o.headers };
    if (cuerpo !== undefined) { headers["Content-Type"] ??= "application/json"; headers["Content-Length"] = String(Buffer.byteLength(cuerpo)); }
    const mod = u.protocol === "http:" ? http : https;
    const extra = ca ?? intermedios.get(u.hostname);
    const tlsOpts = u.protocol === "https:" && (extra?.length || extraEnv.length) ? { ca: [...tls.rootCertificates, ...extraEnv, ...(extra ?? [])] } : {};
    const req = mod.request(u, { method: o.metodo ?? "GET", headers, timeout: o.timeoutMs ?? 20_000, ...tlsOpts }, (res) => {
      const st = res.statusCode ?? 0;
      if (st >= 300 && st < 400 && res.headers.location && saltos < 5) {
        res.resume();
        const sig = new URL(res.headers.location, url).toString();
        pedir(sig, st === 303 ? { ...o, metodo: "GET", cuerpo: undefined } : o, undefined, saltos + 1).then(resolve, reject);
        return;
      }
      const partes: Buffer[] = [];
      res.on("data", (c) => partes.push(c));
      res.on("end", () => resolve({ status: st, texto: Buffer.concat(partes).toString("utf8"), url }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("tiempo de espera agotado"), { code: "ETIMEDOUT" })));
    req.on("error", reject);
    if (cuerpo !== undefined) req.write(cuerpo);
    req.end();
  });
}

/** Lee (sin enviar datos) la dirección AIA «CA Issuers» del certificado que presenta el servidor. */
function urlEmisor(host: string, port: number): Promise<string | null> {
  return new Promise((resolve) => {
    // Solo se inspecciona el certificado del servidor para saber de dónde bajar el intermedio;
    // esta conexión se cierra enseguida y nunca transporta datos de la petición.
    const s = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 10_000 }, () => {
      const c: any = s.getPeerCertificate(false);
      s.end();
      const aia: string | undefined = c?.infoAccess?.["CA Issuers - URI"]?.[0];
      resolve(aia ?? null);
    });
    s.on("error", () => resolve(null));
    s.on("timeout", () => { s.destroy(); resolve(null); });
  });
}

function descargarBinario(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    (u.protocol === "http:" ? http : https).get(u, { timeout: 10_000 }, (res) => {
      const p: Buffer[] = []; res.on("data", (c) => p.push(c)); res.on("end", () => resolve(Buffer.concat(p))); res.on("error", reject);
    }).on("error", reject);
  });
}

async function completarCadena(host: string, port: number): Promise<string[] | null> {
  const aia = await urlEmisor(host, port);
  if (!aia) return null;
  try {
    const raw = await descargarBinario(aia);
    const txt = raw.toString("latin1");
    if (txt.includes("-----BEGIN CERTIFICATE-----")) return [raw.toString("utf8")];
    return [new X509Certificate(raw).toString()]; // DER → PEM
  } catch { return null; }
}

export async function solicitar(url: string, o: Opciones = {}): Promise<Respuesta> {
  try {
    return await pedir(url, o);
  } catch (e: any) {
    const u = new URL(url);
    if (u.protocol !== "https:" || !ERRORES_CADENA.has(e?.code) || intermedios.has(u.hostname)) throw e;
    const pem = await completarCadena(u.hostname, Number(u.port) || 443);
    if (!pem) throw e;
    intermedios.set(u.hostname, pem);
    return pedir(url, o, pem); // verificación completa con el intermedio añadido
  }
}

/** Mensaje entendible para el usuario a partir de un error de red. */
export function explicarError(e: any, sitio: string) {
  const c = e?.code ?? "";
  if (c === "ETIMEDOUT" || c === "ECONNRESET") return `${sitio} no respondió a tiempo`;
  if (c === "ENOTFOUND" || c === "EAI_AGAIN") return `no se encontró el servidor de ${sitio}`;
  if (c === "ECONNREFUSED") return `${sitio} rechazó la conexión`;
  if (ERRORES_CADENA.has(c)) return `el certificado de ${sitio} no se pudo verificar`;
  return `no se pudo conectar con ${sitio}: ${e?.message ?? e}`;
}
