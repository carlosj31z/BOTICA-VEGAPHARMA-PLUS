// Importe en letras para comprobantes (requisito de representación impresa SUNAT).
const U = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE", "DIEZ", "ONCE", "DOCE", "TRECE",
  "CATORCE", "QUINCE", "DIECISEIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE", "VEINTIUNO", "VEINTIDOS", "VEINTITRES",
  "VEINTICUATRO", "VEINTICINCO", "VEINTISEIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE"];
const D = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const C = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

function menorMil(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100), r = n % 100;
  let s = C[c];
  if (r) s += (s ? " " : "") + (r < 30 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? " Y " + U[r % 10] : ""));
  return s;
}

export function numeroALetras(monto: number): string {
  const entero = Math.floor(monto);
  const cent = Math.round((monto - entero) * 100);
  let s: string;
  if (entero === 0) s = "CERO";
  else {
    const mill = Math.floor(entero / 1_000_000), miles = Math.floor((entero % 1_000_000) / 1000), resto = entero % 1000;
    const p: string[] = [];
    if (mill) p.push(mill === 1 ? "UN MILLON" : menorMil(mill) + " MILLONES");
    if (miles) p.push(miles === 1 ? "MIL" : menorMil(miles) + " MIL");
    if (resto) p.push(menorMil(resto));
    s = p.join(" ");
  }
  return `${s.replace(/UNO$/, "UN")} CON ${String(cent).padStart(2, "0")}/100 SOLES`;
}
