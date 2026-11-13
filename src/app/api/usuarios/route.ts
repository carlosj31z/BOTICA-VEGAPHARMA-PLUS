import { NextResponse } from "next/server";
import { perfilActual, supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const ROLES = ["admin", "quimico", "cajero", "almacen"];

/** Alta de usuarios: solo administradores. Usa service_role en el servidor. */
export async function POST(req: Request) {
  const yo = await perfilActual();
  if (!yo || yo.rol !== "admin") return NextResponse.json({ error: "Solo un administrador puede crear usuarios" }, { status: 403 });
  const { email, password, nombre, rol, dni } = await req.json().catch(() => ({}));
  if (!email || !password || password.length < 8 || !nombre || !ROLES.includes(rol))
    return NextResponse.json({ error: "Complete correo, nombre, rol y una contraseña de al menos 8 caracteres" }, { status: 400 });
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nombre }, app_metadata: { creado_por_admin: true, rol } });
  if (error) return NextResponse.json({ error: error.message.includes("already") ? "Ese correo ya está registrado" : error.message }, { status: 400 });
  await admin.from("perfiles").update({ nombre, rol, dni: dni || null, activo: true }).eq("id", data.user.id);
  return NextResponse.json({ id: data.user.id });
}

/** Cambio de contraseña de otro usuario (administrador). */
export async function PATCH(req: Request) {
  const yo = await perfilActual();
  if (!yo || yo.rol !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { id, password } = await req.json().catch(() => ({}));
  if (!id || !password || password.length < 8) return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 });
  const { error } = await supabaseAdmin().auth.admin.updateUserById(id, { password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
