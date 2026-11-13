"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Pencil, Plus, Search } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useApp } from "@/components/app-context";
import { PageHeader, Empty, Field, Spinner } from "@/components/ui";
import { toast } from "@/components/toast";
import { errorMsg } from "@/lib/format";
import { AVISO_FICHA, FichaCuerpo, type Ficha } from "@/components/ficha-medicamento";

const CAMPOS: [keyof Ficha, string, number][] = [
  ["para_que_sirve", "Para qué sirve *", 2], ["como_actua", "Cómo actúa", 2], ["dosis_adulto", "Dosis adulto", 2], ["dosis_pediatrica", "Dosis pediátrica", 2],
  ["contraindicaciones", "Contraindicaciones", 2], ["advertencias", "Advertencias", 2], ["interacciones", "Interacciones", 2], ["consejo", "Qué recomendar al paciente", 2],
];
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function Vademecum() {
  const { puede } = useApp();
  const editor = puede("admin", "quimico");
  const sb = supabaseBrowser();
  const [fichas, setFichas] = useState<Ficha[] | null>(null);
  const [q, setQ] = useState("");
  const [grupo, setGrupo] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  const [edit, setEdit] = useState<Partial<Ficha> | null>(null);
  const [productos, setProductos] = useState<any[]>([]);
  const buscar = useRef<HTMLInputElement>(null);

  const cargar = useCallback(() => sb.from("fichas_medicamento").select("*").order("principio_activo").then(({ data }: any) => setFichas(data ?? [])), [sb]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "F6" || (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA")) { e.preventDefault(); buscar.current?.focus(); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);

  const grupos = useMemo(() => [...new Set((fichas ?? []).map((f) => f.grupo).filter(Boolean) as string[])].sort(), [fichas]);
  const lista = useMemo(() => {
    const t = sinTildes(q.trim());
    return (fichas ?? []).filter((f) => (!grupo || f.grupo === grupo) &&
      (!t || sinTildes([f.principio_activo, f.grupo, f.para_que_sirve].join(" ")).includes(t)));
  }, [fichas, q, grupo]);
  const actual = (fichas ?? []).find((f) => f.id === (sel ?? lista[0]?.id));

  // Productos del inventario con este principio activo (para saber qué ofrecer)
  useEffect(() => {
    if (!actual) { setProductos([]); return; }
    sb.from("v_productos").select("id,nombre,concentracion,laboratorio,precio_unidad,stock_vendible").eq("activo", true)
      .ilike("principio_activo", `%${actual.principio_activo}%`).order("precio_unidad").limit(20).then(({ data }: any) => setProductos(data ?? []));
  }, [actual?.id, actual?.principio_activo, sb]); // eslint-disable-line react-hooks/exhaustive-deps

  async function guardar() {
    if (!edit?.principio_activo?.trim() || !edit.para_que_sirve?.trim()) { toast.error("Complete el principio activo y para qué sirve."); return; }
    const payload: any = { principio_activo: edit.principio_activo.trim(), grupo: edit.grupo?.trim() || null };
    CAMPOS.forEach(([k]) => { payload[k] = (edit[k] as string | null)?.trim() || null; });
    const { data, error } = edit.id
      ? await sb.from("fichas_medicamento").update(payload).eq("id", edit.id).select().single()
      : await sb.from("fichas_medicamento").insert(payload).select().single();
    if (error) { toast.error(error.code === "23505" ? "Ya existe una ficha para ese principio activo." : errorMsg(error)); return; }
    toast.ok("Ficha guardada"); setEdit(null); await cargar(); setSel(data.id);
  }

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader title="Vademécum" subtitle="Para qué sirve cada principio activo, cómo actúa y qué recomendar en el mostrador"
        actions={editor && <button className="btn-primary" onClick={() => setEdit({ principio_activo: "", grupo: "", para_que_sirve: "" })}><Plus className="size-3.5" />Nueva ficha</button>} />
      <div className="card grid min-h-[560px] grid-cols-[300px_minmax(0,1fr)] divide-x divide-zinc-100">
        <div className="flex max-h-[75vh] flex-col">
          <div className="space-y-2 border-b border-zinc-100 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
              <input ref={buscar} autoFocus className="input pl-8" placeholder="Principio activo o síntoma (ej. tos, fiebre)" value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && lista[0]) setSel(lista[0].id); }} />
            </div>
            <select className="input" value={grupo} onChange={(e) => setGrupo(e.target.value)}>
              <option value="">Todos los grupos ({fichas?.length ?? 0})</option>
              {grupos.map((g) => <option key={g}>{g}</option>)}
            </select>
          </div>
          <div className="flex-1 overflow-y-auto">
            {fichas === null ? <div className="py-8 text-center"><Spinner /></div> : lista.length === 0 ? <Empty text="Sin resultados" /> : lista.map((f) => (
              <button key={f.id} onClick={() => { setSel(f.id); setEdit(null); }}
                className={clsx("block w-full border-b border-zinc-50 px-3 py-2 text-left hover:bg-zinc-50", actual?.id === f.id && "bg-marca-50/70")}>
                <p className="text-[12.5px] font-medium text-zinc-900">{f.principio_activo}</p>
                <p className="truncate text-[11.5px] text-zinc-500">{f.grupo}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[75vh] overflow-y-auto p-5">
          {edit ? (
            <div className="max-w-3xl">
              <p className="mb-3 text-[14px] font-semibold text-zinc-900">{edit.id ? `Editar ${edit.principio_activo}` : "Nueva ficha"}</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Principio activo *"><input className="input" value={edit.principio_activo ?? ""} onChange={(e) => setEdit({ ...edit, principio_activo: e.target.value })} /></Field>
                <Field label="Grupo terapéutico"><input className="input" list="grupos" value={edit.grupo ?? ""} onChange={(e) => setEdit({ ...edit, grupo: e.target.value })} />
                  <datalist id="grupos">{grupos.map((g) => <option key={g} value={g} />)}</datalist></Field>
                {CAMPOS.map(([k, l]) => (
                  <Field key={k} label={l} className="col-span-2">
                    <textarea className="input" rows={2} value={(edit[k] as string) ?? ""} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
                  </Field>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button className="btn-ghost" onClick={() => setEdit(null)}>Cancelar</button>
                <button className="btn-primary" onClick={guardar}>Guardar ficha</button>
              </div>
            </div>
          ) : actual ? (
            <div className="max-w-3xl">
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h2 className="text-[18px] font-semibold tracking-tight text-zinc-900">{actual.principio_activo}</h2>
                  {actual.grupo && <p className="text-[12.5px] text-zinc-500">{actual.grupo}</p>}
                </div>
                {editor && <button className="btn-secondary btn-sm" onClick={() => setEdit(actual)}><Pencil className="size-3.5" />Editar</button>}
              </div>
              <div className="[&>div>div:first-child]:hidden"><FichaCuerpo f={actual} /></div>
              {productos.length > 0 && (
                <div className="mt-6">
                  <p className="label">En inventario</p>
                  <table className="tbl rounded-md border border-zinc-200">
                    <thead><tr><th>Producto</th><th>Laboratorio</th><th className="num">Precio unid.</th><th className="num">Stock</th></tr></thead>
                    <tbody>{productos.map((p) => (
                      <tr key={p.id}><td className="font-medium">{p.nombre} {p.concentracion}</td><td className="text-zinc-500">{p.laboratorio}</td>
                        <td className="num">S/ {Number(p.precio_unidad).toFixed(2)}</td><td className={clsx("num", !(p.stock_vendible > 0) && "text-rose-600")}>{p.stock_vendible ?? 0}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              <p className="mt-6 border-t border-zinc-100 pt-3 text-[11.5px] text-zinc-400">{AVISO_FICHA}</p>
            </div>
          ) : <Empty text="Seleccione un principio activo" />}
        </div>
      </div>
    </div>
  );
}
