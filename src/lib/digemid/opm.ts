import type { SupabaseClient } from "@supabase/supabase-js";
import { explicarError, solicitar } from "./http";

/**
 * Observatorio Peruano de Productos Farmacéuticos (OPM, DIGEMID): consulta de precios de mercado.
 * El buscador ciudadano (https://opm-digemid.minsa.gob.pe) usa una API JSON pública:
 *   POST {API}/producto/autocompleteciudadano  → presentaciones de un principio activo (grupo, codGrupoFF, concent)
 *   POST {API}/preciovista/ciudadano           → precios por establecimiento para un grupo (filtrable por ubigeo)
 * Respuesta: { codigo: "00", mensaje, data: [...], cantidad }. Campos por fila: codEstab, codProdE, nombreProducto,
 * nombreComercial (establecimiento), nombreLaboratorio, precio1 (empaque), precio2 (unidad), fracciones, setcodigo
 * (Privado/Público), fecha. La presentación (grupo) se guarda en el producto para no repetir el autocompletado,
 * que DIGEMID limita con más rigor.
 */
const API = (process.env.OPM_API_URL || "https://ms-opm.minsa.gob.pe/msopmcovid").replace(/\/$/, "");
const FRONT = "https://opm-digemid.minsa.gob.pe";
const HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/plain, */*", Origin: FRONT, Referer: FRONT + "/" };

export interface Presentacion { grupo: number; codGrupoFF: string; concent: string; nombreFormaFarmaceutica?: string; nombreProducto?: string }
interface FilaPrecio { codEstab?: string; codProdE?: number | string; nombreProducto?: string; nombreComercial?: string; nombreLaboratorio?: string; precio1?: number; precio2?: number; fracciones?: number; setcodigo?: string; fecha?: string }

class ErrorOpm extends Error { constructor(m: string, public bloqueo = false) { super(m); } }

async function post(ruta: string, filtro: Record<string, unknown>) {
  let r;
  try { r = await solicitar(`${API}${ruta}`, { metodo: "POST", cuerpo: { filtro: { ...filtro, tokenGoogle: "" } }, headers: HEADERS, timeoutMs: 25_000 }); }
  catch (e) { throw new ErrorOpm(explicarError(e, "el Observatorio")); }
  if (r.status === 429 || r.status === 403) throw new ErrorOpm(`El Observatorio limitó las consultas (HTTP ${r.status}). Se reintentará más tarde.`, true);
  if (r.status !== 200) throw new ErrorOpm(`El Observatorio respondió HTTP ${r.status}`);
  let j: any;
  try { j = JSON.parse(r.texto); } catch { throw new ErrorOpm("El Observatorio devolvió una respuesta no válida"); }
  if (j?.codigo && j.codigo !== "00") throw new ErrorOpm(`El Observatorio respondió: ${j.mensaje ?? j.codigo}`);
  return (Array.isArray(j?.data) ? j.data : []) as any[];
}

export const autocompletar = (nombre: string) =>
  post("/producto/autocompleteciudadano", { nombreProducto: nombre, pagina: 1, tamanio: 50 }) as Promise<Presentacion[]>;

export function preciosDe(p: { grupo: number; codGrupoFF: string; concent: string }, ubigeo: string | null, ambito: "distrito" | "provincia") {
  return post("/preciovista/ciudadano", {
    codigoProducto: p.grupo,
    codigoDepartamento: ubigeo ? ubigeo.slice(0, 2) : null,
    codigoProvincia: ubigeo ? ubigeo.slice(0, 4) : null,
    codigoUbigeo: ubigeo && ambito === "distrito" ? ubigeo : null,
    codTipoEstablecimiento: null, catEstablecimiento: null, nombreEstablecimiento: null, nombreLaboratorio: null,
    codGrupoFF: p.codGrupoFF, concent: p.concent, tamanio: 5000, pagina: 1,
  }) as Promise<FilaPrecio[]>;
}

// ---------------------------------------------------------------------
// Utilidades de comparación
// ---------------------------------------------------------------------
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
export const normConc = (s?: string | null) => sinTildes(String(s ?? "").toLowerCase()).replace(/\s+/g, "").replace(/,/g, ".")
  .replace(/(\d)\.0+(?=\D|$)/g, "$1").replace(/gr\b/g, "g").replace(/mcg|µg/g, "ug").replace(/miligramos?/g, "mg");
const FORMAS: [RegExp, RegExp][] = [
  [/tab|comp|cap|gragea|cpr/, /tableta|capsula|comprimido|gragea/],
  [/jarabe|suspens|solucion oral|elixir|emulsion oral|polvo para susp/, /jarabe|suspension|solucion oral|liquido oral|elixir|polvo para/],
  [/inyect|ampolla|vial|iny/, /inyect|parenteral/],
  [/crema|gel|ungu|pomada|locion/, /crema|gel|unguento|pomada|topic|semisolido/],
  [/gota|colirio|oftal|otic/, /gota|oftalm|otic|colirio/],
  [/supositorio|ovulo|vagin|rectal/, /supositorio|ovulo|vaginal|rectal/],
  [/inhal|aerosol|spray|nebul/, /inhal|aerosol|spray|nebul/],
];
function puntajeForma(nuestra: string | null | undefined, suya: string | undefined) {
  const a = sinTildes(String(nuestra ?? "").toLowerCase()), b = sinTildes(String(suya ?? "").toLowerCase());
  if (!a || !b) return 0;
  for (const [ra, rb] of FORMAS) if (ra.test(a)) return rb.test(b) ? 2 : -1;
  return 0;
}
/** Término de búsqueda: el principio activo (o el nombre), mínimo 5 letras como exige el Observatorio. */
export function terminoBusqueda(pa?: string | null, nombre?: string | null) {
  const limpio = (s: string) => sinTildes(s.toUpperCase()).replace(/[^A-Z0-9 +]/g, " ").replace(/\s+/g, " ").trim();
  for (const base of [pa, nombre]) {
    if (!base) continue;
    const t = limpio(base.split(/[+/,;]| y /i)[0]);
    const palabras = t.split(" ").filter((w) => !/^\d/.test(w) && !["MG", "ML", "G", "UI", "MCG"].includes(w));
    const term = palabras.slice(0, 2).join(" ");
    if (term.replace(/\s/g, "").length >= 5) return term;
  }
  return null;
}
const mediana = (v: number[]) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);

function normalizarFila(f: FilaPrecio) {
  let p1 = Number(f.precio1) || 0, p2 = Number(f.precio2) || 0;
  const fr = Number(f.fracciones) || 0;
  if (fr > 1 && p2 > p1 && p1 > 0) [p1, p2] = [p2, p1]; // campos invertidos en origen
  return { ...f, p1, p2 };
}

export function resumirPrecios(filas: FilaPrecio[], codigoDigemid: string | null, codEstabPropio: string | null) {
  const propias = codEstabPropio ? codEstabPropio.padStart(7, "0") : null;
  const privadas = filas.map(normalizarFila).filter((f) => !/p[uú]blic/i.test(f.setcodigo ?? "") && (!propias || String(f.codEstab ?? "").padStart(7, "0") !== propias));
  const exactas = codigoDigemid ? privadas.filter((f) => String(f.codProdE ?? "").trim() === codigoDigemid.trim()) : [];
  const u = exactas.map((f) => f.p2).filter((x) => x > 0), e = exactas.map((f) => f.p1).filter((x) => x > 0);
  const eqU = privadas.filter((f) => f.p2 > 0);
  const barato = eqU.reduce<typeof eqU[number] | null>((m, f) => (!m || f.p2 < m.p2 ? f : m), null);
  return {
    n_exacto: new Set(exactas.map((f) => f.codEstab)).size,
    unidad_min: r2(u.length ? Math.min(...u) : null), unidad_mediana: r2(mediana(u)), unidad_max: r2(u.length ? Math.max(...u) : null),
    empaque_min: r2(e.length ? Math.min(...e) : null), empaque_mediana: r2(mediana(e)), empaque_max: r2(e.length ? Math.max(...e) : null),
    n_equivalentes: new Set(eqU.map((f) => f.codEstab)).size,
    equiv_unidad_min: r2(barato?.p2 ?? null), equiv_unidad_mediana: r2(mediana(eqU.map((f) => f.p2))),
    equiv_mas_barato: barato ? [barato.nombreProducto, barato.nombreLaboratorio, `S/ ${barato.p2.toFixed(2)} c/u`, barato.nombreComercial ? `(${barato.nombreComercial})` : ""].filter(Boolean).join(" · ") : null,
  };
}

// ---------------------------------------------------------------------
// Sincronización por lotes
// ---------------------------------------------------------------------
interface Opc { ids?: number[]; limite?: number; presupuestoMs?: number }

export async function sincronizarPrecios(db: SupabaseClient, o: Opc = {}) {
  const t0 = Date.now();
  const presupuesto = o.presupuestoMs ?? 45_000;
  const { data: emp, error: eEmp } = await db.from("empresa").select("ubigeo, cod_establecimiento").eq("id", 1).single();
  if (eEmp) return { ok: false, mensaje: eEmp.message };
  const ubigeo = String(emp?.ubigeo ?? "").trim();
  if (!/^\d{6}$/.test(ubigeo)) return { ok: false, mensaje: "Configure el ubigeo (6 dígitos) del establecimiento en Configuración para comparar con las boticas de su zona." };

  let q = db.from("productos").select("id, nombre, principio_activo, concentracion, forma_farmaceutica, codigo_digemid, opm_grupo, opm_grupo_ff, opm_concent").eq("activo", true);
  if (o.ids?.length) q = q.in("id", o.ids);
  const { data: prods, error: eP } = await q.limit(5000);
  if (eP) return { ok: false, mensaje: eP.message };
  const { data: hechos } = await db.from("precios_mercado").select("producto_id, consultado_at");
  const ultima = new Map((hechos ?? []).map((h: any) => [h.producto_id, +new Date(h.consultado_at)]));
  const cola = (prods ?? []).filter((p: any) => p.opm_grupo || terminoBusqueda(p.principio_activo, p.nombre))
    .sort((a: any, b: any) => (ultima.get(a.id) ?? 0) - (ultima.get(b.id) ?? 0));
  const limite = o.limite ?? 15;

  const cacheAuto = new Map<string, Presentacion[]>();
  const cachePrecios = new Map<string, FilaPrecio[]>();
  let procesados = 0, conPrecios = 0, bloqueado: string | null = null;
  const errores: string[] = [];

  const precios = async (pr: Presentacion, amb: "distrito" | "provincia") => {
    const k = `${pr.grupo}|${pr.codGrupoFF}|${pr.concent}|${amb}`;
    if (!cachePrecios.has(k)) cachePrecios.set(k, await preciosDe(pr, ubigeo, amb));
    return cachePrecios.get(k)!;
  };

  for (const p of cola.slice(0, limite) as any[]) {
    if (Date.now() - t0 > presupuesto) break;
    let fila: Record<string, unknown>;
    try {
      // 1) Presentación en el Observatorio
      let pres: Presentacion | null = p.opm_grupo ? { grupo: p.opm_grupo, codGrupoFF: p.opm_grupo_ff, concent: p.opm_concent } : null;
      if (!pres) {
        const term = terminoBusqueda(p.principio_activo, p.nombre)!;
        if (!cacheAuto.has(term)) { cacheAuto.set(term, await autocompletar(term)); await new Promise((r) => setTimeout(r, 300)); }
        const opciones = cacheAuto.get(term)!.filter((x) => x.grupo != null);
        const nc = normConc(p.concentracion);
        let cand = nc ? opciones.filter((x) => normConc(x.concent) === nc) : [];
        if (!cand.length && nc) cand = opciones.filter((x) => normConc(x.concent).startsWith(nc) || nc.startsWith(normConc(x.concent)));
        cand = cand.map((x) => ({ x, s: puntajeForma(p.forma_farmaceutica, x.nombreFormaFarmaceutica) })).filter((c) => c.s >= 0).sort((a, b) => b.s - a.s).map((c) => c.x);
        if (!cand.length) throw new ErrorOpm(opciones.length ? `Sin presentación con concentración «${p.concentracion ?? "—"}» en el Observatorio` : `«${term}» no figura en el Observatorio`);
        pres = cand[0];
        // Con código DIGEMID: se prefiere la presentación donde realmente aparece este producto
        if (p.codigo_digemid && cand.length > 1) {
          for (const c of cand.slice(0, 3)) {
            const f = await precios(c, "provincia");
            if (f.some((r) => String(r.codProdE ?? "") === String(p.codigo_digemid).trim())) { pres = c; break; }
          }
        }
        await db.from("productos").update({ opm_grupo: pres.grupo, opm_grupo_ff: String(pres.codGrupoFF), opm_concent: pres.concent }).eq("id", p.id);
      }
      // 2) Precios en el distrito; si hay pocos del mismo producto, en la provincia
      let ambito: "distrito" | "provincia" = "distrito";
      let res = resumirPrecios(await precios(pres, "distrito"), p.codigo_digemid, emp?.cod_establecimiento ?? null);
      if (res.n_exacto < 3) {
        const prov = resumirPrecios(await precios(pres, "provincia"), p.codigo_digemid, emp?.cod_establecimiento ?? null);
        if (prov.n_exacto > res.n_exacto || (res.n_exacto === 0 && prov.n_equivalentes > res.n_equivalentes)) { res = prov; ambito = "provincia"; }
      }
      if (res.n_exacto || res.n_equivalentes) conPrecios++;
      fila = { ...res, ambito, ubigeo, error: res.n_exacto || res.n_equivalentes ? null : "Sin precios reportados en su zona" };
    } catch (e: any) {
      if (e instanceof ErrorOpm && e.bloqueo) { bloqueado = e.message; break; }
      if (!(e instanceof ErrorOpm)) throw e;
      if (/conectar|no respondió|servidor|certificado|HTTP|no válida/.test(e.message) && procesados === 0) return { ok: false, mensaje: e.message };
      errores.push(`${p.nombre}: ${e.message}`);
      fila = { n_exacto: 0, n_equivalentes: 0, ambito: null, ubigeo, error: e.message };
    }
    const { error } = await db.from("precios_mercado").upsert({ producto_id: p.id, consultado_at: new Date().toISOString(), ...fila });
    if (error) return { ok: false, mensaje: error.message };
    procesados++;
  }

  const pendientes = Math.max(0, (o.ids?.length ? o.ids.length : cola.filter((p: any) => !ultima.has(p.id)).length) - procesados);
  if (bloqueado && !procesados) return { ok: false, mensaje: bloqueado };
  return { ok: true, procesados, con_precios: conPrecios, pendientes, total: cola.length, errores: errores.slice(0, 10), aviso: bloqueado };
}
