import { NextResponse } from "next/server";
import { proveedorFacturacion } from "@/lib/facturacion";
export const dynamic = "force-dynamic";
export function GET() {
  const p = proveedorFacturacion();
  return NextResponse.json({ configurado: !!p, proveedor: p?.nombre ?? null });
}
