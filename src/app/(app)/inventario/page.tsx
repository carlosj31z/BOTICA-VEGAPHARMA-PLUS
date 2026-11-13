"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search, MinusCircle, Download } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useApp } from "@/components/app-context";
import { PageHeader, Modal, Field, Empty, Spinner, Stat } from "@/components/ui";
import { toast } from "@/components/toast";
import { S, N, fecha, errorMsg } from "@/lib/format";
import { descargarCSV } from "@/lib/csv";

const dias = (f: string) => Math.round((new Date(f + "T12:00:00").getTime() - Date.now()) / 864e5);

export default function Inventario() {
  const { puede, empresa } = useApp();
  const sb = supabaseBrowser();
  const [rows, setRows] = useState<any[]>([]);
  const [filtro, setFiltro] = useState("por_vencer");
  const [q, setQ] = useState("");
  const [salida, setSalida] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const alerta = Number(empresa.dias_alerta_vencimiento ?? 90);

  const cargar = useCallback(async () => {
    setCargando(true);
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
    const lim = new Date(Date.now() + alerta * 864e5).toLocaleDateString("en-CA");
    let query = sb.from("lotes").select("*, productos!inner(id,nombre,concentracion,codigo,laboratorio_id,unidades_por_empaque,laboratorios(nombre))").gt("stock", 0).order("fecha_vencimiento").limit(2000);
    if (filtro === "vencidos") query = query.lt("fecha_vencimiento", hoy);
    if (filtro === "por_vencer") query = query.gte("fecha_vencimiento", hoy).lte("fecha_vencimiento", lim);
    const term = q.trim().replace(/[,()%]/g, " ");
    if (term) query = query.ilike("productos.nombre", `%${term}%`);
    const { data, error } = await query;
    if (error) toast.error(errorMsg(error));
    setRows(data ?? []); setCargando(false);
  }, [sb, filtro, q, alerta]);
  useEffect(() => { const t = setTimeout(cargar, 200); return () => clearTimeout(t); }, [cargar]);

  const valor = rows.reduce((a, l) => a + l.stock * Number(l.costo_unitario), 0);
  const vencidos = rows.filter((l) => dias(l.fecha_vencimiento) < 0);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Lotes y vencimientos" subtitle="Stock por lote con salida FEFO: se vende primero lo que vence primero"
        actions={<button className="btn-secondary" onClick={() => descargarCSV(`lotes_${filtro}.csv`, [["Producto", "Laboratorio", "Lote", "Vencimiento", "Días", "Stock", "Costo unit.", "Valor"],
          ...rows.map((l) => [`${l.productos.nombre} ${l.productos.concentracion ?? ""}`, l.productos.laboratorios?.nombre, l.numero_lote, l.fecha_vencimiento, dias(l.fecha_vencimiento), l.stock, l.costo_unitario, (l.stock * l.costo_unitario).toFixed(2)])])}>
          <Download className="size-4" />Exportar</button>} />
      <div className="mb-4 grid grid-cols-3 gap-4">
        <Stat label="Lotes en la vista" value={N(rows.length)} />
        <Stat label="Unidades" value={N(rows.reduce((a, l) => a + l.stock, 0))} />
        <Stat label="Valor al costo" value={S(valor)} tone={filtro === "vencidos" && valor > 0 ? "red" : "slate"} hint={filtro === "vencidos" ? "Pérdida por vencimiento" : undefined} />
      </div>
      <div className="card">
        <div className="flex items-center gap-2 border-b border-slate-100 p-3">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-[12.5px]">
            {[["por_vencer", `Por vencer (${alerta} días)`], ["vencidos", "Vencidos"], ["todos", "Todo el stock"]].map(([k, l]) => (
              <button key={k} onClick={() => setFiltro(k)} className={`rounded-md px-2.5 py-1 ${filtro === k ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}>{l}</button>
            ))}
          </div>
          <div className="relative w-80"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-8" placeholder="Buscar producto" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {cargando && <Spinner />}
          {filtro === "vencidos" && vencidos.length > 0 && <p className="ml-auto text-xs text-rose-600">Retire estos lotes del anaquel y registre la baja por vencimiento.</p>}
        </div>
        {rows.length === 0 ? <Empty text="Sin lotes en esta vista" /> : (
          <div className="max-h-[calc(100vh-20rem)] overflow-auto">
            <table className="tbl">
              <thead><tr><th>Producto</th><th>Laboratorio</th><th>Lote</th><th>Vencimiento</th><th>Estado</th><th className="num">Stock (u.)</th><th className="num">Costo u.</th><th className="num">Valor</th><th /></tr></thead>
              <tbody>
                {rows.map((l) => {
                  const d = dias(l.fecha_vencimiento);
                  return (
                    <tr key={l.id}>
                      <td><Link href={`/kardex?producto=${l.producto_id}`} className="font-medium text-slate-900 hover:text-marca-700">{l.productos.nombre} {l.productos.concentracion}</Link></td>
                      <td className="text-slate-500">{l.productos.laboratorios?.nombre}</td>
                      <td className="font-mono text-xs">{l.numero_lote}</td>
                      <td>{fecha(l.fecha_vencimiento)}</td>
                      <td>{d < 0 ? <span className="badge-red">Vencido hace {-d} d</span> : d <= 30 ? <span className="badge-red">{d} días</span> : d <= alerta ? <span className="badge-amber">{d} días</span> : <span className="badge-green">Vigente</span>}</td>
                      <td className="num font-medium">{N(l.stock)}</td>
                      <td className="num text-slate-500">{S(l.costo_unitario)}</td>
                      <td className="num">{S(l.stock * l.costo_unitario)}</td>
                      <td>{puede("admin", "quimico", "almacen") && <button className="btn-ghost btn-sm text-rose-600" onClick={() => setSalida(l)}><MinusCircle className="size-3.5" />Baja</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {salida && <ModalSalida lote={salida} onClose={() => setSalida(null)} onDone={() => { setSalida(null); cargar(); }} />}
    </div>
  );
}

function ModalSalida({ lote, onClose, onDone }: { lote: any; onClose: () => void; onDone: () => void }) {
  const vencido = dias(lote.fecha_vencimiento) < 0;
  const [tipo, setTipo] = useState(vencido ? "vencimiento" : "merma");
  const [cant, setCant] = useState(String(vencido ? lote.stock : ""));
  const [nota, setNota] = useState(vencido ? "Baja por vencimiento" : "");
  const [env, setEnv] = useState(false);
  async function ok() {
    setEnv(true);
    const { error } = await supabaseBrowser().rpc("retirar_stock", { p_lote_id: lote.id, p_cantidad: parseInt(cant) || 0, p_tipo: tipo, p_nota: nota });
    setEnv(false);
    if (error) return toast.error(errorMsg(error));
    toast.ok("Salida registrada en el kardex"); onDone();
  }
  return (
    <Modal open onClose={onClose} title={`Baja de stock · lote ${lote.numero_lote}`} size="sm"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-danger" onClick={ok} disabled={env}>Registrar baja</button></>}>
      <div className="space-y-3">
        <p className="text-[13px] text-slate-600">{lote.productos.nombre} · stock del lote: <b>{lote.stock} u.</b></p>
        <Field label="Motivo"><select className="input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="vencimiento">Vencimiento</option><option value="merma">Merma / deterioro / rotura</option>
          <option value="devolucion_proveedor">Devolución al proveedor</option><option value="ajuste_salida">Ajuste por inventario (faltante)</option></select></Field>
        <Field label="Unidades"><input className="input text-right" inputMode="numeric" value={cant} onChange={(e) => setCant(e.target.value.replace(/\D/g, ""))} /></Field>
        <Field label="Detalle / sustento *"><textarea className="input" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
