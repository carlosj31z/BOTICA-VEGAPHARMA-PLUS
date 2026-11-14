import { NextResponse } from "next/server";
import { perfilActual, supabaseServer } from "@/lib/supabase/server";
import { sincronizarPrecios } from "@/lib/digemid/opm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sincroniza precios de mercado con el Observatorio de DIGEMID, por lotes.
 * POST { ids?: number[], limite?: number }. La pantalla repite la llamada mientras queden pendientes.
 */
export async function POST(req: Request) {
  const p = await perfilActual();
  if (!p || !["admin", "quimico"].includes(p.rol)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    const r = await sincronizarPrecios(await supabaseServer() as any, {
      ids: Array.isArray(body?.ids) ? body.ids.map(Number).filter(Boolean).slice(0, 200) : undefined,
      limite: Math.min(Number(body?.limite) || 12, 40),
      presupuestoMs: 45_000,
    });
    return NextResponse.json(r.ok ? r : { error: r.mensaje }, { status: r.ok ? 200 : 502 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
