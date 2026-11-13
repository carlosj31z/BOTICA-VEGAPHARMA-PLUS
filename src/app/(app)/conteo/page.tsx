"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, Camera, Check, Plus, ScanBarcode, Search } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useApp } from "@/components/app-context";
import { PageHeader, Empty, Spinner } from "@/components/ui";
import { toast } from "@/components/toast";
import { N, S, fecha, fechaHora, errorMsg } from "@/lib/format";
import { ModalCamara, pitido } from "@/components/escaner";

/** Inventario físico: se cuenta por lote (escaneando o escribiendo) y al cerrar se ajusta el stock con la diferencia. */
export default function Conteo() {
  const sb = supabaseBrowser();
  const [conteos, setConteos] = useState<any[] | null>(null);
  const [abierto, setAbierto] = useState<any>(null);
  const cargar = useCallback(() => sb.from("conteos").select("*, perfiles!conteos_usuario_id_fkey(nombre)").order("id", { ascending: false }).limit(50)
    .then(({ data }: any) => setConteos(data ?? [])), [sb]);
  useEffect(() => { cargar(); }, [cargar]);

  async function nuevo() {
    const d = window.prompt("Descripción del inventario", `Inventario ${new Date().toLocaleDateString("es-PE")}`);
    if (d === null) return;
    const { data, error } = await sb.rpc("crear_conteo", { p_descripcion: d });
    if (error) return toast.error(errorMsg(error));
    await cargar();
    const { data: c } = await sb.from("conteos").select("*").eq("id", data).single();
    setAbierto(c);
  }

  if (abierto) return <Hoja conteo={abierto} onSalir={() => { setAbierto(null); cargar(); }} />;
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="Inventario físico" subtitle="Cuente por lote con el lector de códigos. Al cerrar, el stock se ajusta y queda en el kardex."
        actions={<button className="btn-primary" onClick={nuevo}><Plus className="size-3.5" />Nuevo inventario</button>} />
      <div className="card">
        {conteos === null ? <div className="py-10 text-center"><Spinner /></div> : !conteos.length ? <Empty text="Aún no hay inventarios" /> : (
          <table className="tbl">
            <thead><tr><th>N°</th><th>Descripción</th><th>Inicio</th><th>Responsable</th><th>Estado</th><th /></tr></thead>
            <tbody>{conteos.map((c) => (
              <tr key={c.id}>
                <td className="tabular-nums">{c.id}</td><td className="font-medium">{c.descripcion}</td>
                <td className="text-zinc-500">{fechaHora(c.created_at)}</td><td>{c.perfiles?.nombre}</td>
                <td><span className={c.estado === "abierto" ? "badge-amber" : c.estado === "cerrado" ? "badge-green" : "badge-gray"}>{c.estado}</span></td>
                <td className="text-right"><button className="btn-ghost btn-sm" onClick={() => setAbierto(c)}>{c.estado === "abierto" ? "Continuar" : "Ver"}</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Hoja({ conteo, onSalir }: { conteo: any; onSalir: () => void }) {
  const { puede } = useApp();
  const sb = supabaseBrowser();
  const editable = conteo.estado === "abierto";
  const [items, setItems] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [prod, setProd] = useState<any>(null);       // producto activo con sus lotes
  const [solo, setSolo] = useState(false);
  const [camara, setCamara] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const cargar = useCallback(() => sb.from("conteo_items").select("*, productos(nombre,concentracion,codigo_barras), lotes(numero_lote,fecha_vencimiento,stock,costo_unitario)")
    .eq("conteo_id", conteo.id).order("updated_at", { ascending: false }).then(({ data }: any) => setItems(data ?? [])), [sb, conteo.id]);
  useEffect(() => { cargar(); }, [cargar]);

  async function abrirProducto(p: any) {
    const { data: lotes } = await sb.from("lotes").select("*").eq("producto_id", p.id).or(`stock.gt.0,fecha_vencimiento.gte.${new Date().toISOString().slice(0, 10)}`).order("fecha_vencimiento");
    setProd({ ...p, lotes: lotes ?? [] });
    return lotes ?? [];
  }

  async function buscar(texto: string, sumar: boolean) {
    const t = texto.trim().replace(/[,()%]/g, " ");
    if (!t) return;
    const { data } = await sb.from("productos").select("id,nombre,concentracion,codigo_barras").eq("activo", true)
      .or(/^\d{6,14}$/.test(t) ? `codigo_barras.eq.${t},codigo.eq.${t}` : `nombre.ilike.%${t}%,codigo.eq.${t}`).order("nombre").limit(1);
    const p = data?.[0];
    if (!p) { pitido(false); toast.error(`No se encontró «${t}»`); return; }
    const lotes = await abrirProducto(p);
    setQ("");
    // Escaneo: suma 1 al lote que vence primero (lo normal es que esté adelante en el anaquel)
    if (sumar && editable && lotes[0]) { await contar(lotes[0].id, 1, true); pitido(); }
  }

  async function contar(loteId: number, cantidad: number, sumar = false) {
    const { error } = await sb.rpc("contar_lote", { p_conteo_id: conteo.id, p_lote_id: loteId, p_cantidad: cantidad, p_sumar: sumar });
    if (error) { toast.error(errorMsg(error)); return; }
    cargar();
  }

  async function cerrar() {
    const dif = items.filter((i) => i.contado !== i.stock_sistema).length;
    if (!window.confirm(`Se ajustará el stock de ${dif} lote(s) con diferencia. Los lotes no contados no se modifican. ¿Cerrar el inventario?`)) return;
    const { data, error } = await sb.rpc("cerrar_conteo", { p_conteo_id: conteo.id });
    if (error) return toast.error(errorMsg(error));
    toast.ok(`Inventario cerrado: ${data.ajustes} ajustes (${S(data.valor)})`); onSalir();
  }
  async function anular() {
    if (!window.confirm("¿Anular este inventario sin ajustar stock?")) return;
    const { error } = await sb.rpc("anular_conteo", { p_conteo_id: conteo.id });
    if (error) return toast.error(errorMsg(error));
    onSalir();
  }

  const contadoDe = useMemo(() => new Map(items.map((i) => [i.lote_id, i.contado])), [items]);
  const lista = solo ? items.filter((i) => i.contado !== i.stock_sistema) : items;
  const tot = items.reduce((a, i) => ({ dif: a.dif + (i.contado - i.stock_sistema), valor: a.valor + (i.contado - i.stock_sistema) * Number(i.lotes?.costo_unitario ?? 0) }), { dif: 0, valor: 0 });

  return (
    <div className="mx-auto max-w-[1300px]">
      <button onClick={onSalir} className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-zinc-500 hover:text-zinc-800"><ArrowLeft className="size-3.5" />Inventarios</button>
      <PageHeader title={`${conteo.descripcion}`} subtitle={`N° ${conteo.id} · ${items.length} lotes contados · diferencia ${tot.dif > 0 ? "+" : ""}${N(tot.dif)} u. (${S(tot.valor)})`}
        actions={editable && puede("admin", "quimico") && <><button className="btn-ghost" onClick={anular}>Anular</button><button className="btn-accent" onClick={cerrar}><Check className="size-3.5" />Cerrar y ajustar stock</button></>} />

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4">
        <div className="card p-4">
          {editable && (
            <div className="mb-3 flex gap-2">
              <div className="relative flex-1">
                <ScanBarcode className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
                <input ref={ref} autoFocus className="input h-10 pl-9" placeholder="Escanee o escriba el producto" value={q} onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscar(q, /^\d{6,14}$/.test(q.trim())); } }} />
              </div>
              <button className="btn-secondary h-10" onClick={() => buscar(q, false)}><Search className="size-4" /></button>
              <button className="btn-secondary h-10" onClick={() => setCamara(true)}><Camera className="size-4" /></button>
            </div>
          )}
          {!prod ? <p className="py-8 text-center text-[12.5px] text-zinc-400">Cada lectura del código suma 1 unidad al lote que vence primero. Para otro lote o cantidades grandes, escriba la cantidad.</p> : (
            <>
              <p className="text-[14px] font-semibold text-zinc-900">{prod.nombre} {prod.concentracion}</p>
              <table className="tbl mt-2">
                <thead><tr><th>Lote</th><th>Vence</th><th className="num">Sistema</th><th className="num w-28">Contado</th></tr></thead>
                <tbody>{prod.lotes.map((l: any) => (
                  <tr key={l.id}>
                    <td className="font-mono text-[12px]">{l.numero_lote}</td><td>{fecha(l.fecha_vencimiento)}</td>
                    <td className="num text-zinc-500">{N(l.stock)}</td>
                    <td className="num"><input key={contadoDe.get(l.id) ?? "x"} className="input h-7 w-24 text-right tabular-nums" inputMode="numeric" disabled={!editable}
                      defaultValue={contadoDe.get(l.id) ?? ""} placeholder="—"
                      onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); ref.current?.focus(); } }}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v !== "" && Number(v) !== contadoDe.get(l.id)) contar(l.id, parseInt(v) || 0); }} /></td>
                  </tr>
                ))}</tbody>
              </table>
              {!prod.lotes.length && <p className="py-4 text-center text-[12.5px] text-zinc-400">Sin lotes vigentes. Si encontró unidades, regístrelas con «Ingreso de stock».</p>}
            </>
          )}
        </div>

        <div className="card flex max-h-[72vh] flex-col">
          <div className="card-h"><p className="card-t">Contado</p>
            <label className="flex items-center gap-1.5 text-[12px] text-zinc-500"><input type="checkbox" checked={solo} onChange={(e) => setSolo(e.target.checked)} />Solo diferencias</label></div>
          <div className="flex-1 overflow-y-auto">
            {!lista.length ? <Empty text="Nada contado aún" /> : (
              <table className="tbl">
                <thead><tr><th>Producto</th><th>Lote</th><th className="num">Sistema</th><th className="num">Contado</th><th className="num">Dif.</th></tr></thead>
                <tbody>{lista.map((i) => {
                  const d = i.contado - i.stock_sistema;
                  return (
                    <tr key={i.id} className="cursor-pointer" onClick={() => abrirProducto({ id: i.producto_id, ...i.productos })}>
                      <td className="font-medium">{i.productos?.nombre} {i.productos?.concentracion}</td>
                      <td className="font-mono text-[12px]">{i.lotes?.numero_lote}</td>
                      <td className="num text-zinc-500">{N(i.stock_sistema)}</td><td className="num">{N(i.contado)}</td>
                      <td className={clsx("num font-medium", d > 0 ? "text-emerald-700" : d < 0 ? "text-rose-600" : "text-zinc-400")}>{d > 0 ? "+" : ""}{d}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      {camara && <ModalCamara onCodigo={(c) => buscar(c, true)} onClose={() => { setCamara(false); ref.current?.focus(); }} />}
    </div>
  );
}
