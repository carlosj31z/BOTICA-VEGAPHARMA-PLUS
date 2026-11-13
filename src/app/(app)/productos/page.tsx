"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, Search, Pencil, Download, Snowflake, PackagePlus } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useApp } from "@/components/app-context";
import { PageHeader, Modal, Field, Empty, Spinner } from "@/components/ui";
import { toast } from "@/components/toast";
import { S, N, fecha, CONDICION_VENTA, errorMsg } from "@/lib/format";
import { descargarCSV } from "@/lib/csv";
import { ModalIngresoStock } from "@/components/ingreso-stock";
import { FichasProducto } from "@/components/ficha-medicamento";
import type { Producto } from "@/lib/types";

const VACIO: Partial<Producto> = {
  nombre: "", codigo: "", codigo_barras: "", principio_activo: "", concentracion: "", forma_farmaceutica: "Tableta", presentacion: "",
  registro_sanitario: "", codigo_digemid: "", condicion_venta: "libre", lista_control: "", unidades_por_empaque: 1,
  precio_unidad: 0, precio_empaque: 0, afectacion_igv: "gravado", stock_minimo: 0, ubicacion: "", refrigerado: false, activo: true,
};
const FORMAS = ["Tableta", "Tableta recubierta", "Cápsula", "Jarabe", "Suspensión", "Solución oral", "Gotas", "Inyectable", "Crema", "Ungüento", "Gel", "Óvulo", "Supositorio", "Inhalador", "Polvo", "Sobre", "Parche", "Otro"];
const CB: Record<string, string> = { libre: "badge-gray", receta: "badge-blue", receta_retenida: "badge-violet", controlado: "badge-red" };

export default function Productos() {
  const { puede } = useApp();
  const sb = supabaseBrowser();
  const editable = puede("admin", "quimico", "almacen");
  const [rows, setRows] = useState<Producto[]>([]);
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState("activos");
  const [edit, setEdit] = useState<Partial<Producto> | null>(null);
  const [ingreso, setIngreso] = useState<Producto | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    let query = sb.from("v_productos").select("*").order("nombre").limit(2000);
    if (filtro === "activos") query = query.eq("activo", true);
    if (filtro === "inactivos") query = query.eq("activo", false);
    if (filtro === "receta") query = query.neq("condicion_venta", "libre");
    if (filtro === "sin_digemid") query = query.is("codigo_digemid", null).eq("activo", true);
    const term = q.trim().replace(/[,()%]/g, " ");
    if (term) query = query.or(`nombre.ilike.%${term}%,principio_activo.ilike.%${term}%,codigo.ilike.%${term}%,codigo_barras.eq.${term},codigo_digemid.eq.${term}`);
    const { data, error } = await query;
    if (error) toast.error(errorMsg(error));
    setRows(data ?? []); setCargando(false);
  }, [sb, q, filtro]);
  useEffect(() => { const t = setTimeout(cargar, 200); return () => clearTimeout(t); }, [cargar]);

  function exportar() {
    descargarCSV("productos.csv", [
      ["Código", "Código barras", "Nombre", "Principio activo", "Concentración", "Forma", "Presentación", "Laboratorio", "Reg. sanitario", "Cód. DIGEMID",
        "Condición", "Unid/empaque", "Precio unidad", "Precio empaque", "Costo prom.", "Stock", "Stock mín.", "Próx. venc."],
      ...rows.map((p) => [p.codigo, p.codigo_barras, p.nombre, p.principio_activo, p.concentracion, p.forma_farmaceutica, p.presentacion, p.laboratorio,
        p.registro_sanitario, p.codigo_digemid, CONDICION_VENTA[p.condicion_venta], p.unidades_por_empaque, p.precio_unidad, p.precio_empaque,
        p.costo_promedio, p.stock, p.stock_minimo, p.proximo_vencimiento]),
    ]);
  }

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title="Productos" subtitle="Catálogo con datos sanitarios, precios y stock"
        actions={<>
          <button className="btn-secondary" onClick={exportar}><Download className="size-3.5" />Exportar</button>
          {editable && <button className="btn-primary" onClick={() => setEdit({ ...VACIO })}><Plus className="size-3.5" />Nuevo producto</button>}
        </>} />
      <div className="card">
        <div className="flex items-center gap-2 border-b border-zinc-100 p-3">
          <div className="relative w-96"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input className="input pl-8" placeholder="Nombre, principio activo, código, barras o código DIGEMID" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 text-[12.5px]">
            {[["activos", "Activos"], ["receta", "Con receta"], ["sin_digemid", "Sin código DIGEMID"], ["inactivos", "Inactivos"], ["todos", "Todos"]].map(([k, l]) => (
              <button key={k} onClick={() => setFiltro(k)} className={`rounded-md px-2.5 py-1 ${filtro === k ? "bg-white font-medium shadow-sm" : "text-zinc-600"}`}>{l}</button>
            ))}
          </div>
          <span className="ml-auto text-xs text-zinc-500">{cargando ? <Spinner /> : `${rows.length} productos`}</span>
        </div>
        <div className="max-h-[calc(100vh-14rem)] overflow-auto">
          {rows.length === 0 && !cargando ? <Empty text="No hay productos. Cree el primero con «Nuevo producto»." /> : (
            <table className="tbl">
              <thead><tr><th>Producto</th><th>Laboratorio</th><th>Reg. sanitario</th><th>Cód. DIGEMID</th><th>Condición</th>
                <th className="num">P. unidad</th><th className="num">P. caja</th><th className="num">Stock</th><th>Próx. venc.</th><th /></tr></thead>
              <tbody>
                {rows.map((p) => {
                  const bajo = p.stock_minimo > 0 && (p.stock_vendible ?? 0) <= p.stock_minimo;
                  return (
                    <tr key={p.id} className={!p.activo ? "opacity-50" : ""}>
                      <td>
                        <p className="flex items-center gap-1.5 font-medium text-zinc-900">{p.nombre} {p.concentracion}{p.refrigerado && <Snowflake className="size-3.5 text-sky-500" />}</p>
                        <p className="text-xs text-zinc-500">{[p.principio_activo, p.forma_farmaceutica, p.presentacion, p.codigo].filter(Boolean).join(" · ")}</p>
                      </td>
                      <td className="text-zinc-600">{p.laboratorio ?? "—"}</td>
                      <td className="text-xs">{p.registro_sanitario || <span className="text-amber-600">Falta</span>}</td>
                      <td className="text-xs">{p.codigo_digemid || <span className="text-zinc-400">—</span>}</td>
                      <td><span className={CB[p.condicion_venta]}>{CONDICION_VENTA[p.condicion_venta]}{p.lista_control ? ` ${p.lista_control}` : ""}</span></td>
                      <td className="num">{S(p.precio_unidad)}</td>
                      <td className="num">{p.unidades_por_empaque > 1 ? <>{S(p.precio_empaque)}<span className="block text-[10.5px] text-zinc-400">x{p.unidades_por_empaque}</span></> : "—"}</td>
                      <td className={`num font-medium ${bajo ? "text-rose-600" : ""}`}>{N(p.stock)}</td>
                      <td className={`text-xs ${p.proximo_vencimiento && p.proximo_vencimiento < new Date().toLocaleDateString("en-CA") ? "font-medium text-rose-600" : ""}`}>{fecha(p.proximo_vencimiento)}</td>
                      <td className="whitespace-nowrap">
                        {editable && <>
                          <button className="btn-ghost btn-sm" title="Ingresar stock" onClick={() => setIngreso(p)}><PackagePlus className="size-3.5" /></button>
                          <button className="btn-ghost btn-sm" title="Editar" onClick={() => setEdit(p)}><Pencil className="size-3.5" /></button>
                        </>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {edit && <FormProducto inicial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); cargar(); }} />}
      {ingreso && <ModalIngresoStock producto={ingreso} onClose={() => setIngreso(null)} onDone={() => { setIngreso(null); cargar(); }} />}
    </div>
  );
}

function FormProducto({ inicial, onClose, onSaved }: { inicial: Partial<Producto>; onClose: () => void; onSaved: () => void }) {
  const sb = supabaseBrowser();
  const [f, setF] = useState<any>({ ...inicial });
  const [labs, setLabs] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    sb.from("laboratorios").select("*").order("nombre").then(({ data }: any) => setLabs(data ?? []));
    sb.from("categorias").select("*").order("nombre").then(({ data }: any) => setCats(data ?? []));
  }, [sb]);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const margen = f.costo_promedio > 0 && f.precio_unidad > 0 ? ((f.precio_unidad / 1.18 - f.costo_promedio) / (f.precio_unidad / 1.18)) * 100 : null;

  async function nuevoMaestro(tabla: "laboratorios" | "categorias") {
    const nombre = prompt(tabla === "laboratorios" ? "Nombre del laboratorio" : "Nombre de la categoría");
    if (!nombre?.trim()) return;
    const { data, error } = await sb.from(tabla).insert({ nombre: nombre.trim().toUpperCase() }).select().single();
    if (error) return toast.error(errorMsg(error));
    if (tabla === "laboratorios") { setLabs((l) => [...l, data]); set("laboratorio_id", data.id); } else { setCats((c) => [...c, data]); set("categoria_id", data.id); }
  }

  async function guardar() {
    if (!f.nombre?.trim()) return toast.error("Ingrese el nombre del producto.");
    if (!(Number(f.precio_unidad) > 0)) return toast.error("Ingrese el precio de venta por unidad.");
    if (f.unidades_por_empaque > 1 && !(Number(f.precio_empaque) > 0)) return toast.error("Ingrese el precio de venta por caja.");
    if (f.codigo_digemid && !/^\d+$/.test(f.codigo_digemid)) return toast.error("El código DIGEMID solo contiene números.");
    setGuardando(true);
    const campos = ["codigo", "codigo_barras", "nombre", "principio_activo", "concentracion", "forma_farmaceutica", "presentacion", "laboratorio_id", "categoria_id",
      "registro_sanitario", "codigo_digemid", "condicion_venta", "lista_control", "unidades_por_empaque", "precio_unidad", "precio_empaque", "unidades_por_blister", "precio_blister", "afectacion_igv",
      "stock_minimo", "ubicacion", "refrigerado", "activo"];
    const payload: any = {};
    campos.forEach((k) => { const v = f[k]; payload[k] = typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v ?? null; });
    payload.nombre = payload.nombre.toUpperCase();
    payload.unidades_por_empaque = Math.max(1, parseInt(f.unidades_por_empaque) || 1);
    if (payload.unidades_por_empaque === 1) payload.precio_empaque = payload.precio_unidad;
    payload.unidades_por_blister = Math.max(1, parseInt(f.unidades_por_blister) || 1);
    payload.precio_blister = payload.unidades_por_blister > 1 ? Number(f.precio_blister) || 0 : 0;
    if (payload.unidades_por_blister > 1 && !(payload.precio_blister > 0)) { setGuardando(false); return toast.error("Ingrese el precio por blíster."); }
    const { error } = f.id ? await sb.from("productos").update(payload).eq("id", f.id) : await sb.from("productos").insert(payload);
    setGuardando(false);
    if (error) return toast.error(error.code === "23505" ? "Ya existe un producto con ese código." : errorMsg(error));
    toast.ok("Producto guardado"); onSaved();
  }

  return (
    <Modal open onClose={onClose} size="lg" title={f.id ? `Editar ${f.nombre}` : "Nuevo producto"}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={guardar} disabled={guardando}>{guardando && <Spinner />}Guardar</button></>}>
      <div className="space-y-5">
        <BuscarCatalogo onElegir={(c) => setF((x: any) => ({
          ...x, nombre: x.nombre || c.nombre, concentracion: c.concentracion ?? x.concentracion,
          forma_farmaceutica: FORMAS.find((fm) => c.forma_farmaceutica?.toUpperCase().startsWith(fm.toUpperCase().slice(0, 5))) ?? x.forma_farmaceutica,
          presentacion: c.presentacion ?? x.presentacion, principio_activo: c.principio_activo ?? x.principio_activo,
          registro_sanitario: c.registro_sanitario ?? x.registro_sanitario, codigo_digemid: c.cod_prod,
          unidades_por_empaque: c.fraccion && c.fraccion > 1 ? c.fraccion : x.unidades_por_empaque,
        }))} />
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Identificación</p>
          <div className="grid grid-cols-4 gap-3">
            <Field label="Nombre comercial *" className="col-span-2"><input className="input" autoFocus value={f.nombre ?? ""} onChange={(e) => set("nombre", e.target.value)} /></Field>
            <Field label="Concentración"><input className="input" placeholder="500 mg" value={f.concentracion ?? ""} onChange={(e) => set("concentracion", e.target.value)} /></Field>
            <Field label="Forma farmacéutica"><select className="input" value={f.forma_farmaceutica ?? ""} onChange={(e) => set("forma_farmaceutica", e.target.value)}>{FORMAS.map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Principio activo (DCI)" className="col-span-2"><input className="input" value={f.principio_activo ?? ""} onChange={(e) => set("principio_activo", e.target.value)} /></Field>
            <Field label="Presentación"><input className="input" placeholder="Caja x 100 tab." value={f.presentacion ?? ""} onChange={(e) => set("presentacion", e.target.value)} /></Field>
            <Field label="Código interno"><input className="input" value={f.codigo ?? ""} onChange={(e) => set("codigo", e.target.value)} /></Field>
            <Field label="Código de barras" className="col-span-2"><input className="input" value={f.codigo_barras ?? ""} onChange={(e) => set("codigo_barras", e.target.value)} /></Field>
            <Field label="Laboratorio"><div className="flex gap-1"><select className="input" value={f.laboratorio_id ?? ""} onChange={(e) => set("laboratorio_id", e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>{labs.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</select>
              <button type="button" className="btn-secondary px-2" onClick={() => nuevoMaestro("laboratorios")}><Plus className="size-3.5" /></button></div></Field>
            <Field label="Categoría"><div className="flex gap-1"><select className="input" value={f.categoria_id ?? ""} onChange={(e) => set("categoria_id", e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>{cats.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</select>
              <button type="button" className="btn-secondary px-2" onClick={() => nuevoMaestro("categorias")}><Plus className="size-3.5" /></button></div></Field>
          </div>
        </section>
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Datos sanitarios (DIGEMID)</p>
          <div className="grid grid-cols-4 gap-3">
            <Field label="Registro sanitario"><input className="input" placeholder="EN-01234" value={f.registro_sanitario ?? ""} onChange={(e) => set("registro_sanitario", e.target.value.toUpperCase())} /></Field>
            <Field label="Código DIGEMID (Observatorio)" hint="CodProd del catálogo"><input className="input" value={f.codigo_digemid ?? ""} onChange={(e) => set("codigo_digemid", e.target.value)} /></Field>
            <Field label="Condición de venta"><select className="input" value={f.condicion_venta} onChange={(e) => set("condicion_venta", e.target.value)}>
              {Object.entries(CONDICION_VENTA).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Lista de control" hint="Solo controlados (IIA, IIB, IIIA…)"><input className="input" disabled={f.condicion_venta !== "controlado"} value={f.lista_control ?? ""} onChange={(e) => set("lista_control", e.target.value.toUpperCase())} /></Field>
          </div>
        </section>
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Precios e inventario</p>
          <div className="grid grid-cols-4 gap-3">
            <Field label="Unidades por caja" hint="Fracción (1 si no se fracciona)"><input className="input" inputMode="numeric" value={f.unidades_por_empaque ?? 1} onChange={(e) => set("unidades_por_empaque", e.target.value.replace(/\D/g, ""))} /></Field>
            <Field label="Precio venta unidad (S/) *" hint={margen != null ? `Margen ${margen.toFixed(1)}%` : "Incluye IGV"}><input className="input text-right" inputMode="decimal" value={f.precio_unidad ?? ""} onChange={(e) => set("precio_unidad", e.target.value)} /></Field>
            <Field label="Precio venta caja (S/)"><input className="input text-right" inputMode="decimal" disabled={Number(f.unidades_por_empaque) <= 1} value={f.precio_empaque ?? ""} onChange={(e) => set("precio_empaque", e.target.value)} /></Field>
            <Field label="Unidades por blíster" hint="1 si no se vende por blíster"><input className="input" inputMode="numeric" value={f.unidades_por_blister ?? 1} onChange={(e) => set("unidades_por_blister", e.target.value.replace(/\D/g, ""))} /></Field>
            <Field label="Precio venta blíster (S/)"><input className="input text-right" inputMode="decimal" disabled={Number(f.unidades_por_blister ?? 1) <= 1} value={f.precio_blister ?? ""} onChange={(e) => set("precio_blister", e.target.value)} /></Field>
            <Field label="Afectación IGV"><select className="input" value={f.afectacion_igv} onChange={(e) => set("afectacion_igv", e.target.value)}>
              <option value="gravado">Gravado (18%)</option><option value="exonerado">Exonerado</option><option value="inafecto">Inafecto</option></select></Field>
            <Field label="Stock mínimo (unidades)"><input className="input" inputMode="numeric" value={f.stock_minimo ?? 0} onChange={(e) => set("stock_minimo", parseInt(e.target.value) || 0)} /></Field>
            <Field label="Ubicación"><input className="input" placeholder="Anaquel A-3" value={f.ubicacion ?? ""} onChange={(e) => set("ubicacion", e.target.value)} /></Field>
            <label className="mt-6 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!f.refrigerado} onChange={(e) => set("refrigerado", e.target.checked)} />Cadena de frío</label>
            <label className="mt-6 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!f.activo} onChange={(e) => set("activo", e.target.checked)} />Activo</label>
          </div>
        </section>
        {f.id && (
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Orientación al paciente</p>
            <FichasProducto productoId={f.id} />
          </section>
        )}
      </div>
    </Modal>
  );
}

/** Autocompletar desde el catálogo DIGEMID importado: llena datos sanitarios y el CodProd. */
function BuscarCatalogo({ onElegir }: { onElegir: (c: any) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<any[]>([]);
  const [sel, setSel] = useState(0);
  useEffect(() => {
    if (q.trim().length < 3) { setRes([]); return; }
    const t = setTimeout(() => supabaseBrowser().rpc("buscar_catalogo", { p_texto: q, p_limite: 12 }).then(({ data }: any) => { setRes(data ?? []); setSel(0); }), 220);
    return () => clearTimeout(t);
  }, [q]);
  const elegir = (c: any) => { onElegir(c); setQ(""); setRes([]); toast.ok(`Datos tomados del catálogo DIGEMID (${c.cod_prod})`); };
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
      <input className="input bg-zinc-50 pl-8" placeholder="Buscar en el catálogo DIGEMID para completar los datos (nombre, principio activo…)" value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, res.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          else if (e.key === "Enter" && res[sel]) { e.preventDefault(); elegir(res[sel]); }
          else if (e.key === "Escape" && res.length) { e.stopPropagation(); setRes([]); }
        }} />
      {res.length > 0 && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg">
          {res.map((c, i) => (
            <button key={c.cod_prod} onMouseEnter={() => setSel(i)} onClick={() => elegir(c)} className={`block w-full border-b border-zinc-50 px-3 py-1.5 text-left ${i === sel ? "bg-marca-50/70" : ""}`}>
              <p className="text-[12.5px] font-medium text-zinc-900">{c.nombre} {c.concentracion} <span className="font-mono text-[11px] font-normal text-zinc-400">{c.cod_prod}</span></p>
              <p className="truncate text-[11.5px] text-zinc-500">{[c.forma_farmaceutica, c.presentacion, c.registro_sanitario, c.titular, c.situacion].filter(Boolean).join(" · ")}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
