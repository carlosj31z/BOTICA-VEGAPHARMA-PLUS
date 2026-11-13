/** Contrato común para cualquier proveedor de facturación electrónica (PSE/OSE). */
export interface ComprobanteElectronico {
  tipo: "01" | "03" | "07" | "08";
  serie: string;
  numero: number;
  fechaEmision: Date;
  moneda: "PEN" | "USD";
  igvPorcentaje: number;
  cliente: { tipoDocumento: string; numeroDocumento: string; nombre: string; direccion?: string | null; email?: string | null };
  totales: { gravada: number; exonerada: number; inafecta: number; igv: number; descuento: number; total: number };
  items: {
    codigo?: string | null; descripcion: string; unidad: string; cantidad: number;
    valorUnitario: number; precioUnitario: number; descuento: number; // descuento con IGV
    afectacion: "gravado" | "exonerado" | "inafecto"; valorVenta: number; igv: number; total: number;
  }[];
  referencia?: { tipo: "01" | "03"; serie: string; numero: number; tipoNota: string; motivo: string };
}

export interface RespuestaEnvio {
  estado: "aceptado" | "observado" | "rechazado" | "enviado" | "error";
  mensaje: string;
  hash?: string | null;
  qr?: string | null;
  pdfUrl?: string | null;
  xmlUrl?: string | null;
  cdrUrl?: string | null;
  raw?: unknown;
}

export interface ProveedorFacturacion {
  nombre: string;
  enviar(c: ComprobanteElectronico): Promise<RespuestaEnvio>;
  consultar?(c: Pick<ComprobanteElectronico, "tipo" | "serie" | "numero">): Promise<RespuestaEnvio>;
  anular?(c: Pick<ComprobanteElectronico, "tipo" | "serie" | "numero">, motivo: string): Promise<RespuestaEnvio>;
}
