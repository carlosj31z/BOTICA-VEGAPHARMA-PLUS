import { NextResponse } from "next/server";
import { perfilActual, supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { sincronizarAlertas } from "@/lib/digemid/alertas";
import { sincronizarPrecios } from "@/lib/digemid/opm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sincroniza alertas DIGEMID.
 *  - Botón «Sincronizar»: usa la sesión del usuario (admin/químico); no necesita la clave service_role.
 *  - Cron diario de Vercel (Authorization: Bearer CRON_SECRET): usa service_role y, de paso,
 *    actualiza un lote de precios del Observatorio.
 */
async function handler(req: Request) {
  const cron = !!process.env.CRON_SECRET && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  try {
    if (cron) {
      const db = supabaseAdmin();
      const r = await sincronizarAlertas(db);
      const precios = await sincronizarPrecios(db, { limite: 20, presupuestoMs: 25_000 }).catch((e) => ({ ok: false, mensaje: String(e?.message ?? e) }));
      return NextResponse.json({ alertas: r, precios }, { status: r.ok ? 200 : 502 });
    }
    const p = await perfilActual();
    if (!p || !["admin", "quimico"].includes(p.rol)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const r = await sincronizarAlertas(await supabaseServer() as any);
    return NextResponse.json(r.ok ? r : { error: r.mensaje }, { status: r.ok ? 200 : 502 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
export { handler as GET, handler as POST };
