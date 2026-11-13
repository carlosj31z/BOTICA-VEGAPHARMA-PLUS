import { NextResponse } from "next/server";
import { perfilActual, supabaseAdmin } from "@/lib/supabase/server";
import { enviarVenta } from "@/lib/facturacion/enviar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Reenvía comprobantes pendientes o con error. Lo llama el cron de Vercel o un usuario desde la pantalla SUNAT. */
async function handler(req: Request) {
  const cron = req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}` && !!process.env.CRON_SECRET;
  if (!cron && !(await perfilActual())) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { data } = await supabaseAdmin().from("ventas").select("id").in("sunat_estado", ["pendiente", "error", "enviado"])
    .neq("tipo", "NV").eq("anulada", false).lt("sunat_intentos", 20).order("fecha").limit(40);
  const resultados = [];
  for (const v of data ?? []) resultados.push({ id: v.id, ...(await enviarVenta(v.id)) });
  return NextResponse.json({ procesados: resultados.length, aceptados: resultados.filter((r) => r.ok).length, resultados });
}
export { handler as GET, handler as POST };
