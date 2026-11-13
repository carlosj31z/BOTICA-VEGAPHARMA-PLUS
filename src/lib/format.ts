const soles = new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN", minimumFractionDigits: 2 });
const num = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 });

export const S = (n: number | string | null | undefined) => soles.format(Number(n ?? 0));
export const N = (n: number | string | null | undefined) => num.format(Number(n ?? 0));

export function fecha(d: string | Date | null | undefined) {
  if (!d) return "—";
  const x = typeof d === "string" && d.length === 10 ? new Date(d + "T12:00:00") : new Date(d);
  return x.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Lima" });
}
export function fechaHora(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-PE", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Lima",
  });
}
export const hoyLima = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
export const comprobante = (serie: string, numero: number) => `${serie}-${String(numero).padStart(8, "0")}`;

export const TIPO_COMPROBANTE: Record<string, string> = {
  "01": "Factura", "03": "Boleta", "07": "Nota de crédito", "08": "Nota de débito", NV: "Nota de venta",
};
export const METODO_PAGO: Record<string, string> = {
  efectivo: "Efectivo", tarjeta_debito: "Tarjeta débito", tarjeta_credito: "Tarjeta crédito",
  yape: "Yape", plin: "Plin", transferencia: "Transferencia",
};
export const CONDICION_VENTA: Record<string, string> = {
  libre: "Venta libre", receta: "Con receta", receta_retenida: "Receta retenida", controlado: "Controlado",
};
export const ROLES: Record<string, string> = {
  admin: "Administrador", quimico: "Químico farmacéutico", cajero: "Cajero", almacen: "Almacén",
};
export const TIPO_DOC: Record<string, string> = { "0": "Sin documento", "1": "DNI", "4": "C. extranjería", "6": "RUC", "7": "Pasaporte" };

/** Mensaje legible a partir de un error de Supabase/PostgREST. */
export function errorMsg(e: unknown): string {
  if (!e) return "Error desconocido";
  if (typeof e === "string") return e;
  const m = (e as { message?: string }).message ?? String(e);
  if (m.includes("Failed to fetch")) return "Sin conexión con el servidor. Revise su internet e intente de nuevo.";
  return m;
}
