"use client";
import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PageHeader, Stat, Empty, Spinner } from "@/components/ui";
import { S, N, METODO_PAGO, TIPO_COMPROBANTE, hoyLima, errorMsg } from "@/lib/format";
import { descargarCSV } from "@/lib/csv";
import { toast } from "@/components/toast";

export default function Reportes() {
  const sb = supabaseBrowser();
  const [desde, setDesde] = useState(hoyLima().slice(0, 8) + "01");
  const [hasta, setHasta] = useState(hoyLima());
  const [r, setR] = useState<any>(null);
  const [inv, setInv] = useState<any>(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    const [{ data, error }, { data: i }] = await Promise.all([sb.rpc("reporte_ventas", { p_desde: desde, p_hasta: hasta }), sb.rpc("valor_inventario")]);
    if (error) toast.error(errorMsg(error));
    setR(data); setInv(i); setCargando(false);
  }, [sb, desde, hasta]);
  useEffect(() => { cargar(); }, [cargar]);

  const utilidad = r ? Number(r.base) - Number(r.costo) : 0;
  const margen = r && Number(r.base) > 0 ? (utilidad / Number(r.base)) * 100 : 0;
  const maxDia = Math.max(1, ...(r?.por_dia ?? []).map((d: any) => Number(d.total)));
  const maxHora = Math.max(1, ...(r?.por_hora ?? []).map((d: any) => Number(d.total)));
  const totalMetodos = Object.values(r?.por_metodo ?? {}).reduce((a: number, b: any) => a + Number(b), 0) as number;

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Reportes" subtitle="Ventas, rentabilidad e inventario"
        actions={<>
          <input type="date" className="input w-40" value={desde} onChange={(e) => setDesde(e.target.value)} />
          <span className="text-zinc-400">a</span>
          <input type="date" className="input w-40" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          {cargando && <Spinner />}
        </>} />
      {!r ? <Empty /> : (
        <>
          <div className="grid grid-cols-5 gap-4">
            <Stat label="Venta neta" value={S(r.resumen.venta_total)} hint={`IGV ${S(r.resumen.igv)}`} tone="green" />
            <Stat label="Comprobantes" value={N(r.resumen.tickets)} hint={`Ticket promedio ${S(r.resumen.ticket_promedio)}`} />
            <Stat label="Utilidad bruta" value={S(utilidad)} hint={`Margen ${margen.toFixed(1)}% sobre valor de venta`} tone="blue" />
            <Stat label="Devoluciones (NC)" value={S(r.resumen.devoluciones)} tone={Number(r.resumen.devoluciones) ? "amber" : "slate"} />
            <Stat label="Inventario al costo" value={S(inv?.valor_costo)} hint={`${N(inv?.unidades)} u. · a precio venta ${S(inv?.valor_venta)}`} />
          </div>

          <div className="mt-4 grid grid-cols-[1.6fr_1fr] gap-4">
            <div className="card">
              <div className="card-h"><p className="card-t">Venta por día</p></div>
              <div className="flex h-52 items-end gap-1 overflow-x-auto px-4 pb-3 pt-4">
                {r.por_dia.map((d: any) => (
                  <div key={d.dia} className="group relative flex min-w-5 flex-1 flex-col items-center gap-1">
                    <div className="w-full max-w-10 rounded-t bg-marca-500/85 hover:bg-marca-600" style={{ height: `${Math.max(2, (Number(d.total) / maxDia) * 160)}px` }} title={`${d.dia}: ${S(d.total)} (${d.tickets} tickets)`} />
                    <span className="text-[10px] text-zinc-400">{d.dia.slice(8)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="card-h"><p className="card-t">Cobros por medio de pago</p></div>
              <div className="space-y-2.5 p-4">
                {Object.entries(r.por_metodo).sort((a: any, b: any) => b[1] - a[1]).map(([k, v]: any) => (
                  <div key={k}>
                    <div className="flex justify-between text-[13px]"><span>{METODO_PAGO[k]}</span><span className="tabular-nums font-medium">{S(v)}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-zinc-100"><div className="h-1.5 rounded-full bg-marca-500" style={{ width: `${Math.min(100, Math.max(0, (v / (totalMetodos || 1)) * 100))}%` }} /></div>
                  </div>
                ))}
                <div className="border-t border-zinc-100 pt-2 text-xs text-zinc-500">{Object.entries(r.por_tipo).map(([k, v]: any) => `${TIPO_COMPROBANTE[k]}: ${S(v)}`).join(" · ")}</div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-[1.6fr_1fr] gap-4">
            <div className="card">
              <div className="card-h"><p className="card-t">Productos más vendidos</p>
                <button className="btn-ghost btn-sm" onClick={() => descargarCSV(`top_productos_${desde}_${hasta}.csv`, [["Producto", "Unidades", "Venta", "Utilidad"], ...r.top_productos.map((p: any) => [p.producto, p.unidades, p.total, p.utilidad])])}><Download className="size-3.5" />CSV</button></div>
              <table className="tbl"><thead><tr><th>#</th><th>Producto</th><th className="num">Unidades</th><th className="num">Venta</th><th className="num">Utilidad</th></tr></thead>
                <tbody>{r.top_productos.map((p: any, i: number) => (
                  <tr key={i}><td className="text-zinc-400">{i + 1}</td><td>{p.producto}</td><td className="num">{N(p.unidades)}</td><td className="num font-medium">{S(p.total)}</td>
                    <td className={`num ${p.utilidad < 0 ? "text-rose-600" : "text-emerald-700"}`}>{S(p.utilidad)}</td></tr>
                ))}</tbody></table>
            </div>
            <div className="space-y-4">
              <div className="card">
                <div className="card-h"><p className="card-t">Ventas por usuario</p></div>
                <table className="tbl"><tbody>{r.por_usuario.map((u: any, i: number) => (
                  <tr key={i}><td>{u.usuario ?? "—"}</td><td className="num text-zinc-500">{u.tickets} tickets</td><td className="num font-medium">{S(u.total)}</td></tr>
                ))}</tbody></table>
              </div>
              <div className="card">
                <div className="card-h"><p className="card-t">Horas de mayor venta</p></div>
                <div className="flex h-32 items-end gap-1 px-4 pb-3 pt-3">
                  {Array.from({ length: 24 }, (_, h) => r.por_hora.find((x: any) => x.hora === h)).map((d: any, h: number) => (
                    <div key={h} className="flex flex-1 flex-col items-center gap-1">
                      <div className="w-full rounded-t bg-sky-500/80" style={{ height: `${d ? Math.max(2, (Number(d.total) / maxHora) * 90) : 0}px` }} title={d ? `${h}:00 · ${S(d.total)}` : ""} />
                      <span className="text-[9px] text-zinc-400">{h % 3 === 0 ? h : ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
