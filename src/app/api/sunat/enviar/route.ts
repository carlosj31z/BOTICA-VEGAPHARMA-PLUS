import { NextResponse } from "next/server";
import { perfilActual } from "@/lib/supabase/server";
import { enviarVenta } from "@/lib/facturacion/enviar";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const perfil = await perfilActual();
  if (!perfil) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { venta_id } = await req.json().catch(() => ({}));
  if (!Number.isInteger(venta_id)) return NextResponse.json({ error: "venta_id inválido" }, { status: 400 });
  const r = await enviarVenta(venta_id);
  return NextResponse.json(r.ok ? { mensaje: r.mensaje, estado: r.estado } : { error: r.mensaje }, { status: r.ok ? 200 : r.status });
}
