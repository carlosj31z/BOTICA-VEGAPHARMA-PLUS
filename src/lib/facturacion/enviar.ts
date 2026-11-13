import { supabaseAdmin } from "@/lib/supabase/server";
import { proveedorFacturacion, ventaAComprobante } from ".";

/** Envía una venta al proveedor y guarda el resultado. Idempotente: no reenvía aceptados. */
export async function enviarVenta(ventaId: number) {
  const proveedor = proveedorFacturacion();
  if (!proveedor) return { ok: false, status: 503, mensaje: "Facturación electrónica no configurada: agregue NUBEFACT_RUTA y NUBEFACT_TOKEN en Vercel. El comprobante queda pendiente y podrá reenviarse." };
  const db = supabaseAdmin();
  const [{ data: v }, { data: emp }] = await Promise.all([
    db.from("ventas").select("*, clientes(*), venta_items(*, productos(codigo)), ref:venta_referencia_id(tipo,serie,numero)").eq("id", ventaId).single(),
    db.from("empresa").select("igv_porcentaje").eq("id", 1).single(),
  ]);
  if (!v) return { ok: false, status: 404, mensaje: "Comprobante no encontrado" };
  if (v.tipo === "NV") return { ok: false, status: 400, mensaje: "Las notas de venta no se envían a SUNAT" };
  if (["aceptado", "anulado"].includes(v.sunat_estado)) return { ok: true, status: 200, mensaje: "El comprobante ya fue aceptado" };

  await db.from("ventas").update({ sunat_intentos: (v.sunat_intentos ?? 0) + 1 }).eq("id", ventaId);
  try {
    const r = v.sunat_estado === "enviado" && proveedor.consultar
      ? await proveedor.consultar(v)
      : await proveedor.enviar(ventaAComprobante(v, Number(emp?.igv_porcentaje ?? 18)));
    await db.from("ventas").update({
      sunat_estado: r.estado, sunat_mensaje: r.mensaje?.slice(0, 1000), sunat_hash: r.hash ?? v.sunat_hash, sunat_qr: r.qr ?? v.sunat_qr,
      sunat_pdf_url: r.pdfUrl ?? v.sunat_pdf_url, sunat_xml_url: r.xmlUrl ?? v.sunat_xml_url, sunat_cdr_url: r.cdrUrl ?? v.sunat_cdr_url,
      sunat_enviado_at: new Date().toISOString(),
    }).eq("id", ventaId);
    return { ok: r.estado !== "error" && r.estado !== "rechazado", status: 200, mensaje: `${proveedor.nombre}: ${r.mensaje}`, estado: r.estado };
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "Tiempo de espera agotado con el proveedor" : String(e?.message ?? e);
    await db.from("ventas").update({ sunat_estado: "error", sunat_mensaje: msg }).eq("id", ventaId);
    return { ok: false, status: 502, mensaje: msg };
  }
}
