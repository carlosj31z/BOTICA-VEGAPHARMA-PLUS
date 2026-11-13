import { NextResponse } from "next/server";
import { perfilActual } from "@/lib/supabase/server";
import { sincronizarAlertas } from "@/lib/digemid/alertas";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Sincroniza alertas DIGEMID. Lo llama el cron diario de Vercel o el botón «Sincronizar». */
async function handler(req: Request) {
  const cron = !!process.env.CRON_SECRET && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  if (!cron) {
    const p = await perfilActual();
    if (!p || !["admin", "quimico"].includes(p.rol)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const r = await sincronizarAlertas();
  return NextResponse.json(r.ok ? r : { error: r.mensaje }, { status: r.ok ? 200 : 502 });
}
export { handler as GET, handler as POST };
