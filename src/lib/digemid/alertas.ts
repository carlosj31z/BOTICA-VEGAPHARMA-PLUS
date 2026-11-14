import type { SupabaseClient } from "@supabase/supabase-js";
import { explicarError, solicitar } from "./http";

/**
 * Alertas DIGEMID. DIGEMID publica sus alertas en WordPress, en la sección
 * «Publicaciones › Alertas y modificaciones», que además tiene un feed RSS:
 *   https://www.digemid.minsa.gob.pe/webDigemid/publicaciones/alertas-modificaciones/feed/
 * Se lee primero el feed (estructura estable) y, si falla, la página HTML. De cada alerta nueva se abre la
 * publicación para tomar el detalle (productos, lotes, motivo) y el enlace al PDF.
 */
export const URL_ALERTAS = (process.env.DIGEMID_ALERTAS_URL || "https://www.digemid.minsa.gob.pe/webDigemid/publicaciones/alertas-modificaciones/").replace(/\/?$/, "/");

const entidades = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
  .replace(/&#8211;|&ndash;/g, "–").replace(/&#8220;|&#8221;/g, '"').replace(/&#8216;|&#8217;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&[a-z]+;/g, " ");
const limpiar = (s: string) => entidades(entidades(s).replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " "))
  .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();

export interface AlertaLeida { numero: string | null; fecha: string | null; titulo: string; url: string; descripcion?: string | null }

const numeroDe = (...t: (string | undefined)[]) => {
  for (const s of t) {
    const m = s?.match(/N[°ºo.]*\s*(\d{1,3})\s*[-–]\s*(\d{2,4})/i) || s?.match(/alerta[^\d]{0,20}(\d{1,3})[-_](\d{4})/i);
    if (m) return `${m[1].padStart(2, "0")}-${m[2]}`;
  }
  return null;
};
const fechaDe = (s?: string) => {
  const m = s?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/** Feed RSS de WordPress. */
export function extraerDeRss(xml: string): AlertaLeida[] {
  const out: AlertaLeida[] = [];
  for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const it = m[0];
    const tag = (n: string) => it.match(new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`, "i"))?.[1] ?? "";
    const titulo = limpiar(tag("title"));
    const url = limpiar(tag("link"));
    if (!titulo || !/^https?:/.test(url)) continue;
    const pub = tag("pubDate");
    const d = pub ? new Date(limpiar(pub)) : null;
    const desc = limpiar(tag("content:encoded") || tag("description")).replace(/\s*(The post|La entrada)[\s\S]*$/i, "");
    out.push({
      numero: numeroDe(titulo, url),
      fecha: fechaDe(titulo) ?? (d && !isNaN(+d) ? d.toISOString().slice(0, 10) : null),
      titulo: titulo.slice(0, 500), url, descripcion: desc ? desc.slice(0, 2000) : null,
    });
  }
  return out;
}

/** Respaldo: la página HTML de la sección (o la que se configure en DIGEMID_ALERTAS_URL). */
export function extraerAlertas(html: string, base: string): AlertaLeida[] {
  const out = new Map<string, AlertaLeida>();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1].trim();
    const texto = limpiar(m[2]).replace(/\n/g, " ");
    if (href.startsWith("#") || href.startsWith("javascript")) continue;
    const esPdf = /\.pdf($|\?)/i.test(href);
    const esPublicacion = /alerta[s]?[-_ ]?(digemid)?[-_ ]?n/i.test(texto) || /\/alerta-digemid-n/i.test(href);
    if (!(esPublicacion || (esPdf && /alerta/i.test(href + texto)))) continue;
    if (/\/(feed|page|category|tag)\//i.test(href)) continue;
    let url: string;
    try { url = new URL(href, base).toString(); } catch { continue; }
    const antes = html.slice(Math.max(0, m.index - 800), m.index);
    const corte = Math.max(antes.lastIndexOf("<li"), antes.lastIndexOf("<tr"), antes.lastIndexOf("<article"), antes.lastIndexOf("<h"));
    const ctx = limpiar((corte >= 0 ? antes.slice(corte) : antes.slice(-300)) + " " + m[2]).replace(/\n/g, " ");
    const titulo = (texto.length > 12 && !/^(descargar|ver|leer|pdf)/i.test(texto) ? texto : ctx.replace(/\b(descargar|ver m[aá]s|leer m[aá]s|pdf)\b/gi, "").trim()).slice(0, 500);
    out.set(url, { numero: numeroDe(texto, ctx, href), fecha: fechaDe(texto) ?? fechaDe(ctx), titulo: titulo || `Alerta DIGEMID ${numeroDe(href) ?? ""}`.trim(), url });
  }
  return [...out.values()];
}

/** Detalle de una publicación: texto del contenido y enlace al PDF. */
export function extraerDetalle(html: string, base: string) {
  const ini = html.search(/<div[^>]+class=["'][^"']*entry-content/i);
  let cuerpo = ini >= 0 ? html.slice(ini) : html;
  const fin = cuerpo.search(/<(footer|aside)\b|class=["'][^"']*(sharedaddy|post-navigation|jp-relatedposts)/i);
  if (fin > 0) cuerpo = cuerpo.slice(0, fin);
  const pdf = cuerpo.match(/(?:href|src)\s*=\s*["']([^"']+\.pdf)(?:\?[^"']*)?["']/i)?.[1];
  let pdfUrl: string | null = null;
  try { pdfUrl = pdf ? new URL(pdf, base).toString() : null; } catch { /* nada */ }
  const texto = limpiar(cuerpo.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ""));
  return { texto: texto.slice(0, 2500), pdf: pdfUrl };
}

async function leer(url: string) {
  const r = await solicitar(url, { headers: { Accept: "application/rss+xml, application/xml, text/html;q=0.9, */*;q=0.8" } });
  if (r.status !== 200) throw Object.assign(new Error(`DIGEMID respondió ${r.status}`), { status: r.status });
  return r.texto;
}

export async function leerAlertas(): Promise<{ alertas: AlertaLeida[]; via: string; errores: string[] }> {
  const errores: string[] = [];
  // 1) Feed RSS (dos páginas, ~20 alertas más recientes)
  try {
    const xml = await leer(`${URL_ALERTAS}feed/`);
    let alertas = extraerDeRss(xml);
    if (alertas.length) {
      try { alertas = alertas.concat(extraerDeRss(await leer(`${URL_ALERTAS}feed/?paged=2`))); } catch { /* opcional */ }
      return { alertas, via: "rss", errores };
    }
    errores.push("El feed RSS no trajo alertas");
  } catch (e: any) { errores.push(e?.status ? `RSS: ${e.message}` : `RSS: ${explicarError(e, "DIGEMID")}`); }
  // 2) Página HTML
  try {
    const alertas = extraerAlertas(await leer(URL_ALERTAS), URL_ALERTAS);
    if (alertas.length) return { alertas, via: "html", errores };
    errores.push("La página no mostró alertas reconocibles");
  } catch (e: any) { errores.push(e?.status ? `Página: ${e.message}` : `Página: ${explicarError(e, "DIGEMID")}`); }
  return { alertas: [], via: "", errores };
}

/**
 * Sincroniza alertas. `db` puede ser el cliente con la sesión del usuario (admin/químico, por RLS)
 * o el cliente service_role (cron).
 */
export async function sincronizarAlertas(db: SupabaseClient) {
  const { alertas, via, errores } = await leerAlertas();
  if (!alertas.length) return { ok: false as const, mensaje: `No se pudieron leer las alertas de DIGEMID (${errores.join(" · ")}). Puede registrarlas manualmente.` };

  // Únicas por URL y por número (el feed y el PDF pueden repetir la misma alerta)
  const porUrl = new Map(alertas.map((a) => [a.url, a]));
  const lista = [...porUrl.values()];
  const { data: existentes, error: e1 } = await db.from("alertas_sanitarias").select("url, numero")
    .or(`url.in.(${lista.map((a) => `"${a.url.replace(/"/g, '\\"')}"`).join(",")}),numero.in.(${lista.map((a) => a.numero).filter(Boolean).map((n) => `"${n}"`).join(",") || '""'})`);
  if (e1) return { ok: false as const, mensaje: e1.message };
  const yaUrl = new Set((existentes ?? []).map((e: any) => e.url));
  const yaNum = new Set((existentes ?? []).map((e: any) => e.numero).filter(Boolean));
  const vistos = new Set<string>();
  const nuevas = lista.filter((a) => {
    if (yaUrl.has(a.url) || (a.numero && yaNum.has(a.numero))) return false;
    if (a.numero) { if (vistos.has(a.numero)) return false; vistos.add(a.numero); }
    return true;
  });

  // Detalle de las nuevas (máx. 12 por corrida para no exceder el tiempo de la función)
  for (const a of nuevas.slice(0, 12)) {
    if (/\.pdf($|\?)/i.test(a.url)) continue;
    try {
      const d = extraerDetalle(await leer(a.url), a.url);
      const extra = [d.texto, d.pdf ? `PDF: ${d.pdf}` : ""].filter(Boolean).join("\n");
      if (extra) a.descripcion = extra.slice(0, 3000);
      if (!a.fecha) a.fecha = fechaDe(d.texto);
    } catch { /* se guarda con lo que vino en el feed */ }
  }

  if (nuevas.length) {
    const { error } = await db.from("alertas_sanitarias").insert(nuevas.map((a) => ({
      numero: a.numero, fecha: a.fecha, titulo: a.titulo, url: a.url, descripcion: a.descripcion ?? null, fuente: "digemid",
    })));
    if (error) return { ok: false as const, mensaje: error.message };
  }
  return { ok: true as const, mensaje: `${lista.length} alertas leídas de DIGEMID, ${nuevas.length} nuevas.`, nuevas: nuevas.length, via };
}
