/**
 * Formato 12.1 SUNAT: "Registro del inventario permanente en unidades físicas – detalle del inventario permanente
 * en unidades físicas" (R.S. 234-2006/SUNAT). Tablas: 5 (tipo de existencia), 6 (unidad), 10 (comprobante), 12 (operación).
 */
const OPERACION: Record<string, string> = {
  venta: "01", compra: "02", devolucion_venta: "05", devolucion_proveedor: "06", inventario_inicial: "16",
  merma: "13", vencimiento: "14", ajuste_entrada: "99", ajuste_salida: "99",
};

/** Tipo de comprobante (tabla 10) a partir de la referencia guardada en el kardex. */
function documento(tipo: string, ref: string | null): [string, string, string] {
  const r = (ref ?? "").replace(/^Compra\s+/i, "").trim();
  const m = r.match(/^([A-Z0-9]{4})-0*(\d+)$/i);
  let td = "00";
  if (m) {
    const s = m[1].toUpperCase();
    td = s.startsWith("BC") || s.startsWith("FC") ? "07" : s.startsWith("B") ? "03" : s.startsWith("F") ? "01" : tipo === "compra" ? "01" : "00";
    return [td, s, m[2]];
  }
  const p = r.split("-");
  return [tipo === "compra" ? "01" : "00", p.length > 1 ? p[0] : "", p.length > 1 ? p.slice(1).join("-") : r];
}

export type Mov = { producto_id: number; tipo: string; cantidad: number; referencia: string | null; created_at: string };
export type ProdK = { id: number; codigo: string | null; nombre: string; concentracion: string | null; stock_actual: number };

export async function excelKardex12_1(o: { anio: number; mes: number; empresa: Record<string, any>; productos: ProdK[]; movs: Mov[]; movsPosteriores: Mov[] }) {
  const writeXlsxFile = (await import("write-excel-file")).default;
  const periodo = `${o.anio}${String(o.mes).padStart(2, "0")}00`;
  const despues = new Map<number, number>();
  o.movsPosteriores.forEach((m) => despues.set(m.producto_id, (despues.get(m.producto_id) ?? 0) + m.cantidad));
  const porProd = new Map<number, Mov[]>();
  o.movs.forEach((m) => porProd.set(m.producto_id, [...(porProd.get(m.producto_id) ?? []), m]));

  const B = (v: string) => ({ value: v, fontWeight: "bold" as const });
  const filas: any[][] = [
    [{ value: "FORMATO 12.1: REGISTRO DEL INVENTARIO PERMANENTE EN UNIDADES FÍSICAS – DETALLE DEL INVENTARIO PERMANENTE EN UNIDADES FÍSICAS", fontWeight: "bold", span: 8 }],
    [B("PERÍODO:"), { value: periodo }], [B("RUC:"), { value: String(o.empresa.ruc ?? "") }],
    [B("APELLIDOS Y NOMBRES, DENOMINACIÓN O RAZÓN SOCIAL:"), { value: o.empresa.razon_social ?? "" }],
    [B("ESTABLECIMIENTO:"), { value: o.empresa.direccion ?? "" }], [],
  ];
  const lima = (iso: string) => new Date(iso).toLocaleDateString("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric" });

  for (const p of o.productos) {
    const ms = (porProd.get(p.id) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const enPeriodo = ms.reduce((a, m) => a + m.cantidad, 0);
    const saldoFinal = p.stock_actual - (despues.get(p.id) ?? 0);
    const saldoInicial = saldoFinal - enPeriodo;
    if (!ms.length && saldoFinal === 0) continue;
    filas.push(
      [B("CÓDIGO DE LA EXISTENCIA:"), { value: p.codigo ?? String(p.id) }],
      [B("TIPO (TABLA 5):"), { value: "01 MERCADERÍAS" }],
      [B("DESCRIPCIÓN:"), { value: `${p.nombre} ${p.concentracion ?? ""}`.trim() }],
      [B("UNIDAD DE MEDIDA (TABLA 6):"), { value: "NIU UNIDAD" }],
      ["FECHA", "TIPO DOC. (TABLA 10)", "SERIE", "NÚMERO", "TIPO OPERACIÓN (TABLA 12)", "ENTRADAS", "SALIDAS", "SALDO FINAL"].map(B),
      ["", "", "", "", { value: "16 SALDO INICIAL" }, "", "", { value: saldoInicial, type: Number }],
    );
    let saldo = saldoInicial, ent = 0, sal = 0;
    for (const m of ms) {
      saldo += m.cantidad; if (m.cantidad > 0) ent += m.cantidad; else sal -= m.cantidad;
      const [td, serie, num] = documento(m.tipo, m.referencia);
      filas.push([{ value: lima(m.created_at) }, { value: td }, { value: serie }, { value: num }, { value: OPERACION[m.tipo] ?? "99" },
        m.cantidad > 0 ? { value: m.cantidad, type: Number } : null, m.cantidad < 0 ? { value: -m.cantidad, type: Number } : null, { value: saldo, type: Number }]);
    }
    filas.push(["", "", "", "", B("TOTALES"), { value: ent, type: Number, fontWeight: "bold" }, { value: sal, type: Number, fontWeight: "bold" }, { value: saldo, type: Number, fontWeight: "bold" }], []);
  }
  await writeXlsxFile(filas, {
    fileName: `Formato_12.1_${o.empresa.ruc ?? ""}_${periodo}.xlsx`,
    sheet: "Formato 12.1",
    columns: [{ width: 14 }, { width: 12 }, { width: 10 }, { width: 14 }, { width: 22 }, { width: 12 }, { width: 12 }, { width: 14 }],
  });
}
