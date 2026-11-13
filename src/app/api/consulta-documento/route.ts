import { NextResponse } from "next/server";
import { perfilActual } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Consulta de DNI (RENIEC) y RUC (SUNAT) a través de un proveedor con token.
 * CONSULTA_DOC_PROVEEDOR = decolecta (por defecto) | apisnet ; CONSULTA_DOC_TOKEN = token del proveedor.
 * Respuesta normalizada: { nombre, direccion?, estado?, condicion? }
 */
const PROVEEDORES: Record<string, { dni: string; ruc: string }> = {
  decolecta: { dni: "https://api.decolecta.com/v1/reniec/dni?numero=", ruc: "https://api.decolecta.com/v1/sunat/ruc?numero=" },
  apisnet: { dni: "https://api.apis.net.pe/v2/reniec/dni?numero=", ruc: "https://api.apis.net.pe/v2/sunat/ruc?numero=" },
};

const txt = (...v: unknown[]) => v.find((x) => typeof x === "string" && x.trim()) as string | undefined;

function normalizar(d: any, tipo: "dni" | "ruc") {
  if (tipo === "dni") {
    const nombres = txt(d.nombres, d.first_name);
    const ap = [txt(d.apellidoPaterno, d.apellido_paterno, d.first_last_name), txt(d.apellidoMaterno, d.apellido_materno, d.second_last_name)].filter(Boolean).join(" ");
    const nombre = txt(d.full_name, d.nombre_completo, d.nombre) ?? [ap, nombres].filter(Boolean).join(" ");
    return { nombre: nombre?.replace(/\s+/g, " ").trim() };
  }
  const direccion = txt(d.direccion_completa, d.direccion, d.domicilio_fiscal);
  const extra = [txt(d.distrito), txt(d.provincia), txt(d.departamento)].filter(Boolean).join(" - ");
  return {
    nombre: txt(d.razon_social, d.razonSocial, d.nombre),
    direccion: direccion && extra && !direccion.includes(extra.split(" - ")[0]) ? `${direccion} ${extra}` : direccion,
    estado: txt(d.estado), condicion: txt(d.condicion),
  };
}

export async function GET(req: Request) {
  if (!(await perfilActual())) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const numero = new URL(req.url).searchParams.get("numero")?.trim() ?? "";
  const tipo = /^\d{8}$/.test(numero) ? "dni" : /^(10|15|17|20)\d{9}$/.test(numero) ? "ruc" : null;
  if (!tipo) return NextResponse.json({ error: "Ingrese un DNI de 8 dígitos o un RUC de 11" }, { status: 400 });
  const token = process.env.CONSULTA_DOC_TOKEN;
  if (!token) return NextResponse.json({ error: "Consulta RENIEC/SUNAT no configurada (CONSULTA_DOC_TOKEN)" }, { status: 501 });
  const prov = PROVEEDORES[process.env.CONSULTA_DOC_PROVEEDOR ?? "decolecta"] ?? PROVEEDORES.decolecta;
  try {
    const r = await fetch(prov[tipo] + numero, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000), cache: "no-store",
    });
    if (r.status === 404) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
    if (!r.ok) return NextResponse.json({ error: `El servicio de consulta respondió ${r.status}` }, { status: 502 });
    const datos = normalizar(await r.json(), tipo);
    if (!datos.nombre) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
    return NextResponse.json({ tipo_documento: tipo === "dni" ? "1" : "6", ...datos });
  } catch {
    return NextResponse.json({ error: "No se pudo consultar el documento. Ingrese los datos a mano." }, { status: 504 });
  }
}
