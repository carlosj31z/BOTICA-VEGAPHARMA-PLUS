import { Nubefact } from "./nubefact";
import type { ProveedorFacturacion, ComprobanteElectronico } from "./tipos";
export type { ComprobanteElectronico, RespuestaEnvio, ProveedorFacturacion } from "./tipos";

/**
 * Devuelve el proveedor configurado. Para cambiar de proveedor (APISUNAT, Efact, Bizlinks, SUNAT directo con
 * certificado propio…) se implementa la interfaz ProveedorFacturacion y se registra aquí: el resto del ERP no cambia.
 */
export function proveedorFacturacion(): ProveedorFacturacion | null {
  const p = (process.env.FACTURACION_PROVEEDOR ?? "nubefact").toLowerCase();
  if (p === "nubefact" && process.env.NUBEFACT_RUTA && process.env.NUBEFACT_TOKEN) {
    return new Nubefact(process.env.NUBEFACT_RUTA, process.env.NUBEFACT_TOKEN);
  }
  return null;
}

/** Convierte una venta de la BD (con cliente, items y referencia) al formato común. */
export function ventaAComprobante(v: any, igvPorcentaje: number): ComprobanteElectronico {
  return {
    tipo: v.tipo, serie: v.serie, numero: v.numero, fechaEmision: new Date(v.fecha), moneda: v.moneda ?? "PEN", igvPorcentaje,
    cliente: { tipoDocumento: v.clientes.tipo_documento, numeroDocumento: v.clientes.numero_documento, nombre: v.clientes.nombre,
      direccion: v.clientes.direccion, email: v.clientes.email },
    totales: { gravada: +v.op_gravada, exonerada: +v.op_exonerada, inafecta: +v.op_inafecta, igv: +v.igv, descuento: +v.descuento, total: +v.total },
    items: v.venta_items.map((i: any) => ({
      codigo: i.productos?.codigo ?? String(i.producto_id), descripcion: i.descripcion, unidad: i.unidad, cantidad: +i.cantidad,
      valorUnitario: +i.valor_unitario, precioUnitario: +i.precio_unitario, descuento: +i.descuento, afectacion: i.afectacion_igv,
      valorVenta: +i.valor_venta, igv: +i.igv, total: +i.total,
    })),
    referencia: v.ref ? { tipo: v.ref.tipo, serie: v.ref.serie, numero: v.ref.numero, tipoNota: v.tipo_nota ?? "01", motivo: v.motivo_nota ?? "" } : undefined,
  };
}
