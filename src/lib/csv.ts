/** Genera y descarga un CSV (UTF-8 con BOM para que Excel respete tildes). */
export function aCSV(filas: unknown[][], { separador = ",", eol = "\r\n" } = {}) {
  return filas.map((f) => f.map((c) => {
    const s = c == null ? "" : String(c);
    return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(separador)).join(eol) + eol;
}

export function descargar(nombre: string, contenido: BlobPart, tipo = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement("a");
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function descargarCSV(nombre: string, filas: unknown[][]) {
  descargar(nombre, "﻿" + aCSV(filas));
}
