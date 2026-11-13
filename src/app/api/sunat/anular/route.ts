import { NextResponse } from "next/server";
import { perfilActual, supabaseServer } from "@/lib/supabase/server";
import { proveedorFacturacion } from "@/lib/facturacion";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Anulación de boleta o factura (comunicación de baja / resumen diario a través del PSE).
 * Solo dentro de los 7 días de emitida y sin nota de crédito. Después se devuelve el stock con anular_comprobante.
 */
export async function POST(req: Request) {
  const perfil = await perfilActual();
  if (!perfil || !["admin", "quimico"].includes(perfil.rol)) return NextResponse.json({ error: "Solo el administrador o el químico farmacéutico pueden anular" }, { status: 403 });
  const { venta_id, motivo } = await req.json().catch(() => ({}));
  if (!Number.isInteger(venta_id) || !String(motivo ?? "").trim()) return NextResponse.json({ error: "Indique el comprobante y el motivo" }, { status: 400 });

  const sb = await supabaseServer();
  const { data: v } = await sb.from("ventas").select("id,tipo,serie,numero,fecha,anulada,sunat_estado").eq("id", venta_id).single();
  if (!v) return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
  if (!["01", "03"].includes(v.tipo)) return NextResponse.json({ error: "Solo se anulan boletas y facturas" }, { status: 400 });
  if (v.anulada) return NextResponse.json({ error: "El comprobante ya está anulado" }, { status: 400 });
  const { count } = await sb.from("ventas").select("id", { count: "exact", head: true }).eq("venta_referencia_id", venta_id).eq("tipo", "07").eq("anulada", false);
  if (count) return NextResponse.json({ error: "Tiene nota de crédito: no se puede anular" }, { status: 400 });

  let mensaje = "Anulado en el sistema (SUNAT lo había rechazado).";
  if (v.sunat_estado !== "rechazado") {
    if (Date.now() - new Date(v.fecha).getTime() > 7 * 864e5) return NextResponse.json({ error: "Pasaron más de 7 días: emita una nota de crédito" }, { status: 400 });
    if (["pendiente", "error"].includes(v.sunat_estado)) return NextResponse.json({ error: "Primero envíe el comprobante a SUNAT (está pendiente). Luego podrá anularlo." }, { status: 400 });
    const prov = proveedorFacturacion();
    if (!prov?.anular) return NextResponse.json({ error: "Facturación electrónica no configurada" }, { status: 501 });
    const r = await prov.anular({ tipo: v.tipo, serie: v.serie, numero: v.numero }, String(motivo).trim().slice(0, 100));
    if (r.estado === "error" || r.estado === "rechazado") return NextResponse.json({ error: `SUNAT/PSE: ${r.mensaje}` }, { status: 502 });
    mensaje = r.mensaje;
  }
  const { error } = await sb.rpc("anular_comprobante", { p_venta_id: venta_id, p_motivo: String(motivo).trim() });
  if (error) return NextResponse.json({ error: `La baja se envió, pero no se pudo registrar en el sistema: ${error.message}` }, { status: 500 });
  return NextResponse.json({ mensaje });
}
