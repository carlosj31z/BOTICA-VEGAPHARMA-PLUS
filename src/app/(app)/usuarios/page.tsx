"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, KeyRound } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useApp } from "@/components/app-context";
import { PageHeader, Modal, Field, Spinner } from "@/components/ui";
import { toast } from "@/components/toast";
import { ROLES, fechaHora, errorMsg } from "@/lib/format";

const PERMISOS: Record<string, string> = {
  admin: "Todo el sistema, usuarios y configuración",
  quimico: "Ventas, controlados, notas de crédito, inventario, compras y reportes",
  cajero: "Punto de venta, caja y consulta de productos",
  almacen: "Productos, lotes, compras y proveedores",
};

export default function Usuarios() {
  const { perfil } = useApp();
  const sb = supabaseBrowser();
  const [rows, setRows] = useState<any[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [clave, setClave] = useState<any>(null);
  const cargar = useCallback(async () => { const { data } = await sb.from("perfiles").select("*").order("nombre"); setRows(data ?? []); }, [sb]);
  useEffect(() => { cargar(); }, [cargar]);

  async function actualizar(id: string, patch: any) {
    if (id === perfil.id && (patch.rol && patch.rol !== "admin" || patch.activo === false)) return toast.error("No puede quitarse su propio acceso de administrador.");
    const { error } = await sb.from("perfiles").update(patch).eq("id", id);
    if (error) return toast.error(errorMsg(error));
    toast.ok("Usuario actualizado"); cargar();
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="Usuarios" subtitle="Cada persona con su propio acceso: todo queda registrado con su nombre"
        actions={<button className="btn-primary" onClick={() => setNuevo(true)}><Plus className="size-3.5" />Nuevo usuario</button>} />
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Permisos</th><th>Estado</th><th>Alta</th><th /></tr></thead>
          <tbody>{rows.map((u) => (
            <tr key={u.id}>
              <td className="font-medium">{u.nombre}{u.id === perfil.id && <span className="badge-gray ml-2">Usted</span>}</td>
              <td className="text-zinc-500">{u.email}</td>
              <td><select className="input h-8 w-48" value={u.rol} onChange={(e) => actualizar(u.id, { rol: e.target.value })}>{Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
              <td className="max-w-64 text-xs text-zinc-500">{PERMISOS[u.rol]}</td>
              <td><button onClick={() => actualizar(u.id, { activo: !u.activo })} className={u.activo ? "badge-green" : "badge-red"}>{u.activo ? "Activo" : "Inactivo"}</button></td>
              <td className="text-xs text-zinc-500">{fechaHora(u.created_at)}</td>
              <td><button className="btn-ghost btn-sm" title="Cambiar contraseña" onClick={() => setClave(u)}><KeyRound className="size-3.5" /></button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {nuevo && <ModalNuevo onClose={() => setNuevo(false)} onDone={() => { setNuevo(false); cargar(); }} />}
      {clave && <ModalClave u={clave} onClose={() => setClave(null)} />}
    </div>
  );
}

function ModalNuevo({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ nombre: "", email: "", dni: "", rol: "cajero", password: "" }); const [env, setEnv] = useState(false);
  async function crear() {
    setEnv(true);
    const r = await fetch("/api/usuarios", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
    const j = await r.json().catch(() => ({})); setEnv(false);
    if (!r.ok) return toast.error(j.error ?? "No se pudo crear");
    toast.ok("Usuario creado. Entréguele su correo y contraseña."); onDone();
  }
  return (
    <Modal open onClose={onClose} title="Nuevo usuario" footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={crear} disabled={env}>{env && <Spinner />}Crear</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nombre completo" className="col-span-2"><input className="input" autoFocus value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Field>
        <Field label="Correo (usuario)"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="DNI"><input className="input" value={f.dni} onChange={(e) => setF({ ...f, dni: e.target.value })} /></Field>
        <Field label="Rol"><select className="input" value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })}>{Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Contraseña inicial" hint="Mínimo 8 caracteres"><input className="input" type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function ModalClave({ u, onClose }: { u: any; onClose: () => void }) {
  const [p, setP] = useState("");
  async function ok() {
    const r = await fetch("/api/usuarios", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: u.id, password: p }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return toast.error(j.error ?? "Error");
    toast.ok("Contraseña actualizada"); onClose();
  }
  return (
    <Modal open onClose={onClose} title={`Nueva contraseña · ${u.nombre}`} size="sm" footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={ok}>Guardar</button></>}>
      <Field label="Contraseña" hint="Mínimo 8 caracteres"><input className="input" autoFocus value={p} onChange={(e) => setP(e.target.value)} /></Field>
    </Modal>
  );
}
