import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Lectura de las alertas publicadas por DIGEMID. DIGEMID no ofrece una API: se lee la página pública
 * de alertas y se extraen los enlaces a cada alerta (PDF o página). Si DIGEMID cambia su web, basta con
 * ajustar DIGEMID_ALERTAS_URL o este parser; mientras tanto las alertas se pueden registrar a mano.
 */
export const URL_ALERTAS = process.env.DIGEMID_ALERTAS_URL || "https://www.digemid.minsa.gob.pe/webDigemid/alertas-modificaciones/";

const limpiar = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

export interface AlertaLeida { numero: string | null; fecha: string | null; titulo: string; url: string }

export function extraerAlertas(html: string, base: string): AlertaLeida[] {
  const out = new Map<string, AlertaLeida>();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1].trim();
    const texto = limpiar(m[2]);
    const esAlerta = /alerta/i.test(href) || /alerta/i.test(texto);
    if (!esAlerta || href.startsWith("#") || href.startsWith("javascript")) continue;
    if (!/\.pdf($|\?)/i.test(href) && !/alerta\s*(digemid)?\s*n/i.test(texto)) continue;
    let url: string;
    try { url = new URL(href, base).toString(); } catch { continue; }
    // Contexto cercano (para fecha y título cuando el enlace solo dice "Descargar")
    const antes = html.slice(Math.max(0, m.index - 800), m.index);
    const corte = Math.max(antes.lastIndexOf("<li"), antes.lastIndexOf("<tr"), antes.lastIndexOf("<p"), antes.lastIndexOf("<article"), antes.lastIndexOf("<h"));
    const ctx = limpiar((corte >= 0 ? antes.slice(corte) : antes.slice(-300)) + " " + m[2]);
    const num = (texto.match(/N[°ºo.]*\s*(\d{1,3}\s*[-–]\s*\d{2,4})/i) || ctx.match(/N[°ºo.]*\s*(\d{1,3}\s*[-–]\s*\d{2,4})/i) || href.match(/(\d{1,3}[-_]\d{2,4})\.pdf/i))?.[1]?.replace(/[_\s–]/g, "-").replace(/-+/g, "-") ?? null;
    const f = (texto.match(/(\d{2})\/(\d{2})\/(\d{4})/) || ctx.match(/(\d{2})\/(\d{2})\/(\d{4})/));
    const titulo = (texto.length > 12 && !/^descargar|^ver|^pdf$/i.test(texto) ? texto : ctx.replace(/\b(descargar|ver m[aá]s|pdf)\b/gi, "").trim()).slice(0, 500);
    out.set(url, { numero: num, fecha: f ? `${f[3]}-${f[2]}-${f[1]}` : null, titulo: titulo || `Alerta DIGEMID ${num ?? ""}`.trim(), url });
  }
  return [...out.values()];
}

export async function sincronizarAlertas() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  let html: string;
  try {
    const r = await fetch(URL_ALERTAS, {
      signal: ctrl.signal, cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36", "Accept-Language": "es-PE,es;q=0.9" },
    });
    if (!r.ok) return { ok: false, mensaje: `DIGEMID respondió ${r.status}. Puede registrar la alerta manualmente.` };
    html = await r.text();
  } catch (e: any) {
    return { ok: false, mensaje: e?.name === "AbortError" ? "DIGEMID no respondió a tiempo." : `No se pudo leer la web de DIGEMID: ${e?.message ?? e}` };
  } finally { clearTimeout(t); }

  const alertas = extraerAlertas(html, URL_ALERTAS);
  if (!alertas.length) return { ok: false, mensaje: "La página de DIGEMID no mostró alertas reconocibles (puede haber cambiado de formato)." };
  const db = supabaseAdmin();
  const { data: existentes } = await db.from("alertas_sanitarias").select("url").in("url", alertas.map((a) => a.url));
  const ya = new Set((existentes ?? []).map((e: any) => e.url));
  const nuevas = alertas.filter((a) => !ya.has(a.url));
  if (nuevas.length) {
    const { error } = await db.from("alertas_sanitarias").insert(nuevas.map((a) => ({ ...a, fuente: "digemid" })));
    if (error) return { ok: false, mensaje: error.message };
  }
  return { ok: true, mensaje: `${alertas.length} alertas leídas, ${nuevas.length} nuevas.`, nuevas: nuevas.length };
}
