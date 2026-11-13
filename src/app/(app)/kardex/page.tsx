"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Search } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PageHeader, Empty, Spinner } from "@/components/ui";
import { S, N, fechaHora } from "@/lib/format";
import { descargarCSV } from "@/lib/csv";

const TIPOS: Record<string, [string, string]> = {
  inventario_inicial: ["Inventario inicial", "badge-blue"], compra: ["Compra", "badge-green"], venta: ["Venta", "badge-gray"],
  devolucion_venta: ["Devolución venta", "badge-blue"], devolucion_proveedor: ["Devol. proveedor", "badge-amber"],
  ajuste_entrada: ["Ajuste +", "badge-green"], ajuste_salida: ["Ajuste −", "badge-amber"], merma: ["Merma", "badge-red"], vencimiento: ["Vencimiento", "badge-red"],
};

function KardexInner() {
  const sb = supabaseBrowser();
  const params = useSearchParams();
  const [q, setQ] = useState("");
  const [opciones, setOpciones] = useState<any[]>([]);
  const [prod, setProd] = useState<any>(null);
  const [movs, setMovs] = useState<any[]>([]);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    const id = params.get("producto");
    if (id) sb.from("productos").select("*").eq("id", id).single().then(({ data }: any) => setProd(data));
  }, [params, sb]);

  useEffect(() => {
    const term = q.trim(); if (term.length < 2) { setOpciones([]); return; }
    const t = setTimeout(() => sb.from("productos").select("id,nombre,concentracion,codigo").ilike("nombre", `%${term}%`).limit(12).then(({ data }: any) => setOpciones(data ?? [])), 200);
    return () => clearTimeout(t);
  }, [q, sb]);

  useEffect(() => {
    if (!prod) return;
    setCargando(true);
    sb.from("movimientos").select("*, lotes(numero_lote, fecha_vencimiento), perfiles(nombre)").eq("producto_id", prod.id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1000)
      .then(({ data }: any) => { setMovs(data ?? []); setCargando(false); });
  }, [prod, sb]);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Kardex" subtitle="Movimientos valorizados por producto y lote"
        actions={prod && <button className="btn-secondary" onClick={() => descargarCSV(`kardex_${prod.codigo ?? prod.id}.csv`, [["Fecha", "Tipo", "Referencia", "Lote", "Vencimiento", "Entrada", "Salida", "Saldo", "Costo unit.", "Usuario", "Nota"],
          ...[...movs].reverse().map((m) => [fechaHora(m.created_at), TIPOS[m.tipo]?.[0], m.referencia, m.lotes?.numero_lote, m.lotes?.fecha_vencimiento, m.cantidad > 0 ? m.cantidad : "", m.cantidad < 0 ? -m.cantidad : "", m.saldo, m.costo_unitario, m.perfiles?.nombre, m.nota])])}>
          <Download className="size-4" />Exportar</button>} />
      <div className="card">
        <div className="relative border-b border-slate-100 p-3">
          <div className="relative w-[28rem]"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-8" placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {opciones.length > 0 && (
            <div className="absolute left-3 top-full z-20 mt-1 w-[28rem] rounded-lg border border-slate-200 bg-white shadow-lg">
              {opciones.map((o) => <button key={o.id} onClick={() => { setProd(o); setQ(""); setOpciones([]); }} className="block w-full px-3 py-2 text-left text-[13px] hover:bg-slate-50">{o.nombre} {o.concentracion}</button>)}
            </div>
          )}
          {prod && <p className="mt-2 text-[13px]">Producto: <b>{prod.nombre} {prod.concentracion}</b> · saldo actual <b>{N(movs[0]?.saldo ?? 0)} u.</b></p>}
        </div>
        {!prod ? <Empty text="Seleccione un producto para ver su kardex" /> : cargando ? <div className="grid h-40 place-items-center"><Spinner /></div> : movs.length === 0 ? <Empty /> : (
          <div className="max-h-[calc(100vh-16rem)] overflow-auto">
            <table className="tbl">
              <thead><tr><th>Fecha</th><th>Movimiento</th><th>Referencia</th><th>Lote</th><th className="num">Entrada</th><th className="num">Salida</th><th className="num">Saldo</th><th className="num">Costo u.</th><th>Usuario</th><th>Nota</th></tr></thead>
              <tbody>
                {movs.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap text-slate-500">{fechaHora(m.created_at)}</td>
                    <td><span className={TIPOS[m.tipo]?.[1]}>{TIPOS[m.tipo]?.[0]}</span></td>
                    <td>{m.referencia ?? "—"}</td>
                    <td className="font-mono text-xs">{m.lotes?.numero_lote}</td>
                    <td className="num text-emerald-700">{m.cantidad > 0 ? N(m.cantidad) : ""}</td>
                    <td className="num text-rose-700">{m.cantidad < 0 ? N(-m.cantidad) : ""}</td>
                    <td className="num font-semibold">{N(m.saldo)}</td>
                    <td className="num text-slate-500">{S(m.costo_unitario)}</td>
                    <td className="text-slate-500">{m.perfiles?.nombre}</td>
                    <td className="max-w-56 truncate text-xs text-slate-500">{m.nota}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Kardex() { return <Suspense><KardexInner /></Suspense>; }
