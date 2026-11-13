import JSZip from "jszip";
import { aCSV } from "./csv";

/**
 * Archivo de precios para el Observatorio Peruano de Productos Farmacéuticos (DIGEMID).
 * Formato según el manual de carga vigente: CSV UTF-8, separador coma, fin de línea CRLF,
 * cabecera exacta «CodEstab,CodProd,Precio 1,Precio 2».
 *  - CodEstab: código del establecimiento, 7 dígitos con ceros a la izquierda.
 *  - CodProd: código del producto en el catálogo DIGEMID.
 *  - Precio 1: precio de venta por empaque; Precio 2: precio por unidad (2 decimales).
 */
export interface FilaObservatorio { codigo_digemid: string; precio_empaque: number; precio_unidad: number; unidades_por_empaque: number }

export function csvObservatorio(codEstab: string, filas: FilaObservatorio[]) {
  const est = codEstab.trim().padStart(7, "0");
  const vistos = new Set<string>();
  const datos: (string | number)[][] = [["CodEstab", "CodProd", "Precio 1", "Precio 2"]];
  for (const f of filas) {
    const cod = String(f.codigo_digemid).trim();
    if (!cod || vistos.has(cod)) continue;
    const p1 = Number(f.precio_empaque) > 0 ? Number(f.precio_empaque).toFixed(2) : "";
    const p2 = Number(f.precio_unidad) > 0 ? Number(f.precio_unidad).toFixed(2) : "";
    if (!p1 && !p2) continue;
    vistos.add(cod);
    datos.push([est, cod, p1, p2]);
  }
  return { csv: aCSV(datos), registros: datos.length - 1 };
}

export function nombreArchivo(ruc: string, codEstab: string, fecha = new Date()) {
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const anio = String(fecha.getFullYear() % 100).padStart(2, "0");
  return `${ruc || "RUC"}_${codEstab || "COD"}_${mes}_${anio}_CARGA ARCHIVO`.slice(0, 70);
}

export async function zipObservatorio(nombre: string, csv: string) {
  const zip = new JSZip();
  zip.file(`${nombre}.csv`, csv);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
