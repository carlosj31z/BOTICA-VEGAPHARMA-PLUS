"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Plus, Printer } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useApp } from "@/components/app-context";
import { PageHeader, Empty, Field, Modal, Spinner } from "@/components/ui";
import { toast } from "@/components/toast";
import { fechaHora, fecha, errorMsg } from "@/lib/format";

const VACIO = { consumidor_nombre: "", consumidor_documento: "", consumidor_domicilio: "", consumidor_telefono: "", consumidor_email: "", apoderado: "",
  bien_tipo: "producto", bien_descripcion: "", monto: "", tipo: "reclamo", detalle: "", pedido: "" };

/** Libro de Reclamaciones virtual del establecimiento (Ley 29571). */
export default function Reclamaciones() {
  const { puede } = useApp();
  const sb = supabaseBrowser();
  const [rows, setRows] = useState<any[] | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [resp, setResp] = useState<any>(null);
  const cargar = useCallback(() => sb.from("reclamaciones").select("*").order("id", { ascending: false }).limit(500).then(({ data }: any) => setRows(data ?? [])), [sb]);
  useEffect(() => { cargar(); }, [cargar]);
  const hoja = (id: number) => window.open(`/reclamaciones/${id}`, "hoja", "width=820,height=900");
  const vence = (f: string) => { const d = new Date(f); d.setDate(d.getDate() + 21); return d; };

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader title="Libro de Reclamaciones" subtitle="Registro obligatorio (Ley 29571). Entregue copia de la hoja al consumidor y responda en máximo 15 días hábiles."
        actions={<button className="btn-primary" onClick={() => setNuevo(true)}><Plus className="size-3.5" />Nueva hoja</button>} />
      <div className="card">
        {rows === null ? <div className="py-10 text-center"><Spinner /></div> : rows.length === 0 ? <Empty text="Sin reclamaciones registradas" /> : (
          <table className="tbl">
            <thead><tr><th>N°</th><th>Fecha</th><th>Tipo</th><th>Consumidor</th><th>Detalle</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const atrasado = !r.respuesta && vence(r.fecha) < new Date();
                return (
                  <tr key={r.id}>
                    <td className="font-mono text-[12px]">{r.numero}</td>
                    <td className="whitespace-nowrap text-zinc-500">{fechaHora(r.fecha)}</td>
                    <td><span className={r.tipo === "reclamo" ? "badge-blue" : "badge-violet"}>{r.tipo === "reclamo" ? "Reclamo" : "Queja"}</span></td>
                    <td><p className="font-medium">{r.consumidor_nombre}</p><p className="text-[11.5px] text-zinc-500">{r.consumidor_documento}</p></td>
                    <td className="max-w-80 truncate text-zinc-600">{r.detalle}</td>
                    <td>{r.respuesta ? <span className="badge-green">Respondido</span> : <span className={atrasado ? "badge-red" : "badge-amber"}>{atrasado ? "Vencido" : `Responder antes del ${fecha(vence(r.fecha).toISOString())}`}</span>}</td>
                    <td className="whitespace-nowrap text-right">
                      {puede("admin", "quimico") && !r.respuesta && <button className="btn-ghost btn-sm" onClick={() => setResp({ ...r, respuesta: "" })}>Responder</button>}
                      <button className="btn-ghost btn-sm" onClick={() => hoja(r.id)}><Printer className="size-3.5" />Hoja</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {nuevo && <NuevaHoja onClose={() => setNuevo(false)} onOk={(id) => { setNuevo(false); cargar(); hoja(id); }} />}
      {resp && (
        <Modal open onClose={() => setResp(null)} title={`Responder hoja N° ${resp.numero}`} size="md"
          footer={<><button className="btn-ghost" onClick={() => setResp(null)}>Cancelar</button>
            <button className="btn-primary" onClick={async () => {
              if (!resp.respuesta.trim()) return toast.error("Escriba la respuesta o acciones adoptadas.");
              const { error } = await sb.from("reclamaciones").update({ respuesta: resp.respuesta.trim(), respondido_at: new Date().toISOString(), respondido_por: (await sb.auth.getUser()).data.user?.id }).eq("id", resp.id);
              if (error) return toast.error(errorMsg(error));
              toast.ok("Respuesta registrada"); setResp(null); cargar();
            }}>Guardar respuesta</button></>}>
          <p className="mb-2 text-[12.5px] text-zinc-600">{resp.detalle}</p>
          <p className="mb-3 text-[12.5px]"><span className="text-zinc-500">Pedido: </span>{resp.pedido}</p>
          <Field label="Observaciones y acciones adoptadas"><textarea className="input" rows={5} autoFocus value={resp.respuesta} onChange={(e) => setResp({ ...resp, respuesta: e.target.value })} /></Field>
          <p className="mt-2 text-[11.5px] text-zinc-400">Comunique la respuesta al consumidor por el medio que indicó (correo o teléfono).</p>
        </Modal>
      )}
    </div>
  );
}

function NuevaHoja({ onClose, onOk }: { onClose: () => void; onOk: (id: number) => void }) {
  const [f, setF] = useState<any>(VACIO);
  const [g, setG] = useState(false);
  const set = (k: string, v: string) => setF((x: any) => ({ ...x, [k]: v }));
  async function guardar() {
    for (const [k, l] of [["consumidor_nombre", "nombre"], ["consumidor_documento", "documento"], ["bien_descripcion", "producto o servicio"], ["detalle", "detalle"], ["pedido", "pedido"]])
      if (!String(f[k]).trim()) return toast.error(`Complete: ${l}.`);
    setG(true);
    const payload: any = { ...f, monto: f.monto ? Number(f.monto) : null };
    Object.keys(payload).forEach((k) => { if (payload[k] === "") payload[k] = null; });
    const { data, error } = await supabaseBrowser().from("reclamaciones").insert(payload).select("id").single();
    setG(false);
    if (error) return toast.error(errorMsg(error));
    toast.ok("Hoja registrada. Imprima la copia para el consumidor."); onOk(data.id);
  }
  return (
    <Modal open onClose={onClose} title="Nueva hoja de reclamación" size="lg"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={guardar} disabled={g}>{g && <Spinner />}Registrar e imprimir</button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Nombre del consumidor *" className="col-span-2"><input className="input" autoFocus value={f.consumidor_nombre} onChange={(e) => set("consumidor_nombre", e.target.value)} /></Field>
          <Field label="DNI / CE *"><input className="input" value={f.consumidor_documento} onChange={(e) => set("consumidor_documento", e.target.value)} /></Field>
          <Field label="Domicilio" className="col-span-2"><input className="input" value={f.consumidor_domicilio} onChange={(e) => set("consumidor_domicilio", e.target.value)} /></Field>
          <Field label="Teléfono"><input className="input" value={f.consumidor_telefono} onChange={(e) => set("consumidor_telefono", e.target.value)} /></Field>
          <Field label="Correo"><input className="input" type="email" value={f.consumidor_email} onChange={(e) => set("consumidor_email", e.target.value)} /></Field>
          <Field label="Padre o madre (si es menor)" className="col-span-2"><input className="input" value={f.apoderado} onChange={(e) => set("apoderado", e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <Field label="Bien contratado"><select className="input" value={f.bien_tipo} onChange={(e) => set("bien_tipo", e.target.value)}><option value="producto">Producto</option><option value="servicio">Servicio</option></select></Field>
          <Field label="Descripción *" className="col-span-2"><input className="input" value={f.bien_descripcion} onChange={(e) => set("bien_descripcion", e.target.value)} /></Field>
          <Field label="Monto (S/)"><input className="input text-right" inputMode="decimal" value={f.monto} onChange={(e) => set("monto", e.target.value)} /></Field>
        </div>
        <div>
          <div className="seg mb-1">
            <button data-on={f.tipo === "reclamo"} onClick={() => set("tipo", "reclamo")}>Reclamo</button>
            <button data-on={f.tipo === "queja"} onClick={() => set("tipo", "queja")}>Queja</button>
          </div>
          <p className={clsx("mb-2 text-[11.5px] text-zinc-500")}>{f.tipo === "reclamo" ? "Disconformidad con el producto o servicio." : "Malestar con la atención, no relacionado al producto."}</p>
          <Field label="Detalle *"><textarea className="input" rows={3} value={f.detalle} onChange={(e) => set("detalle", e.target.value)} /></Field>
          <Field label="Pedido del consumidor *" className="mt-3"><textarea className="input" rows={2} value={f.pedido} onChange={(e) => set("pedido", e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}
