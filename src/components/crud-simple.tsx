"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Search } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PageHeader, Modal, Field, Empty, Spinner } from "./ui";
import { toast } from "./toast";
import { errorMsg } from "@/lib/format";

export type Campo = { k: string; l: string; tipo?: "text" | "select" | "check"; opciones?: [string, string][]; req?: boolean; ancho?: 1 | 2; tabla?: boolean; upper?: boolean };

/** Mantenimiento genérico para maestros sencillos (proveedores, clientes…). */
export function CrudSimple({ tabla, titulo, subtitulo, campos, busqueda, orden, editable = true, validar }: {
  tabla: string; titulo: string; subtitulo: string; campos: Campo[]; busqueda: string[]; orden: string; editable?: boolean;
  validar?: (f: any) => string | null;
}) {
  const sb = supabaseBrowser();
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<any>(null);
  const [env, setEnv] = useState(false);

  const cargar = useCallback(async () => {
    let query = sb.from(tabla).select("*").order(orden).limit(1000);
    const t = q.trim().replace(/[,()%]/g, " ");
    if (t) query = query.or(busqueda.map((b) => `${b}.ilike.%${t}%`).join(","));
    const { data } = await query; setRows(data ?? []);
  }, [sb, tabla, q, busqueda, orden]);
  useEffect(() => { const t = setTimeout(cargar, 200); return () => clearTimeout(t); }, [cargar]);

  async function guardar() {
    for (const c of campos) if (c.req && !String(edit[c.k] ?? "").trim()) return toast.error(`Complete: ${c.l}`);
    const err = validar?.(edit); if (err) return toast.error(err);
    setEnv(true);
    const payload: any = {};
    campos.forEach((c) => { let v = edit[c.k]; if (typeof v === "string") { v = v.trim(); if (c.upper) v = v.toUpperCase(); if (v === "") v = null; } payload[c.k] = v ?? (c.tipo === "check" ? false : null); });
    const { error } = edit.id ? await sb.from(tabla).update(payload).eq("id", edit.id) : await sb.from(tabla).insert(payload);
    setEnv(false);
    if (error) return toast.error(error.code === "23505" ? "Ya existe un registro con ese documento." : errorMsg(error));
    toast.ok("Guardado"); setEdit(null); cargar();
  }

  const visibles = campos.filter((c) => c.tabla !== false);
  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader title={titulo} subtitle={subtitulo} actions={editable && <button className="btn-primary" onClick={() => setEdit(Object.fromEntries(campos.map((c) => [c.k, c.tipo === "check" ? true : c.opciones?.[0]?.[0] ?? ""])))}><Plus className="size-4" />Nuevo</button>} />
      <div className="card">
        <div className="border-b border-slate-100 p-3"><div className="relative w-96"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-8" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        {rows.length === 0 ? <Empty /> : (
          <table className="tbl">
            <thead><tr>{visibles.map((c) => <th key={c.k}>{c.l}</th>)}{editable && <th className="w-10" />}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>{visibles.map((c) => <td key={c.k}>{c.tipo === "check" ? (r[c.k] ? <span className="badge-green">Sí</span> : <span className="badge-gray">No</span>) : c.opciones ? c.opciones.find((o) => o[0] === r[c.k])?.[1] ?? r[c.k] : r[c.k] ?? "—"}</td>)}
                {editable && <td><button className="btn-ghost btn-sm" onClick={() => setEdit(r)}><Pencil className="size-3.5" /></button></td>}</tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? "Editar" : "Nuevo registro"}
          footer={<><button className="btn-secondary" onClick={() => setEdit(null)}>Cancelar</button><button className="btn-primary" onClick={guardar} disabled={env}>{env && <Spinner />}Guardar</button></>}>
          <div className="grid grid-cols-2 gap-3">
            {campos.map((c) => c.tipo === "check" ? (
              <label key={c.k} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!edit[c.k]} onChange={(e) => setEdit({ ...edit, [c.k]: e.target.checked })} />{c.l}</label>
            ) : (
              <Field key={c.k} label={c.l + (c.req ? " *" : "")} className={c.ancho === 2 ? "col-span-2" : ""}>
                {c.opciones ? <select className="input" value={edit[c.k] ?? ""} onChange={(e) => setEdit({ ...edit, [c.k]: e.target.value })}>{c.opciones.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  : <input className="input" value={edit[c.k] ?? ""} onChange={(e) => setEdit({ ...edit, [c.k]: e.target.value })} />}
              </Field>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
