"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Banknote, Receipt, FileWarning, BellRing, ShoppingCart, Truck, PackagePlus, ArrowRight } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PageHeader, Stat, Empty } from "@/components/ui";
import { S, fechaHora, comprobante, TIPO_COMPROBANTE } from "@/lib/format";
import { useApp } from "@/components/app-context";
import { EstadoSunat } from "@/components/estado-sunat";

const SEV: Record<string, string> = { alta: "badge-red", media: "badge-amber", baja: "badge-gray" };
const TIPO_ALERTA: Record<string, string> = {
  vencido: "Vencido", por_vencer: "Por vencer", stock_bajo: "Stock bajo", sunat_pendiente: "SUNAT", sin_registro_sanitario: "Reg. sanitario",
};

export default function Tablero() {
  const { perfil } = useApp();
  const [t, setT] = useState<any>(null);
  const [alertas, setAlertas] = useState<any[]>([]);
  const [ventas, setVentas] = useState<any[]>([]);
  const [semana, setSemana] = useState<{ dia: string; total: number }[]>([]);

  useEffect(() => {
    const sb = supabaseBrowser();
    sb.rpc("tablero_hoy").then(({ data }: any) => setT(data));
    sb.from("v_alertas").select("*").limit(200).then(({ data }: any) => { const o: Record<string, number> = { alta: 0, media: 1, baja: 2 }; setAlertas((data ?? []).sort((a: any, b: any) => o[a.severidad] - o[b.severidad])); });
    sb.from("ventas").select("id,tipo,serie,numero,fecha,total,sunat_estado,anulada,clientes(nombre)")
      .order("fecha", { ascending: false }).limit(8).then(({ data }: any) => setVentas(data ?? []));
    const desde = new Date(Date.now() - 6 * 864e5); desde.setHours(0, 0, 0, 0);
    sb.from("ventas").select("fecha,total,tipo").gte("fecha", desde.toISOString()).eq("anulada", false).then(({ data }: any) => {
      const m = new Map<string, number>();
      for (let i = 6; i >= 0; i--) m.set(new Date(Date.now() - i * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Lima" }), 0);
      (data ?? []).forEach((v: any) => {
        const k = new Date(v.fecha).toLocaleDateString("en-CA", { timeZone: "America/Lima" });
        if (m.has(k)) m.set(k, m.get(k)! + (v.tipo === "07" ? -1 : 1) * Number(v.total));
      });
      setSemana([...m].map(([dia, total]) => ({ dia, total })));
    });
  }, []);

  const max = Math.max(1, ...semana.map((s) => s.total));
  const alta = alertas.filter((a) => a.severidad === "alta").length;

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title={`Hola, ${perfil.nombre.split(" ").find((w) => !w.endsWith(".")) ?? perfil.nombre}`} subtitle="Resumen de la operación de hoy"
        actions={<>
          <Link href="/compras/nueva" className="btn-secondary"><Truck className="size-4" />Registrar compra</Link>
          <Link href="/pos" className="btn-primary"><ShoppingCart className="size-4" />Nueva venta <span className="kbd ml-1 border-white/30 bg-white/10 text-white shadow-none">F1</span></Link>
        </>} />

      <div className="grid grid-cols-4 gap-4">
        <Stat label="Ventas de hoy" value={S(t?.ventas_hoy)} hint={`${t?.tickets_hoy ?? 0} comprobantes`} icon={<Banknote className="size-4" />} tone="green" />
        <Stat label="Turnos abiertos" value={t?.turnos_abiertos ?? "—"} hint="Cajas en operación" icon={<Receipt className="size-4" />} tone="blue" />
        <Stat label="Pendientes SUNAT" value={t?.pendientes_sunat ?? "—"} hint={<Link href="/sunat" className="text-marca-700 hover:underline">Ver comprobantes</Link>}
          icon={<FileWarning className="size-4" />} tone={t?.pendientes_sunat ? "amber" : "slate"} />
        <Stat label="Alertas activas" value={alertas.length} hint={`${alta} de prioridad alta`} icon={<BellRing className="size-4" />} tone={alta ? "red" : "slate"} />
      </div>

      <div className="mt-4 grid grid-cols-[1.6fr_1fr] gap-4">
        <div className="space-y-4">
          <div className="card">
            <div className="card-h"><p className="card-t">Ventas de los últimos 7 días</p></div>
            <div className="flex h-44 items-end gap-3 px-5 pb-4 pt-6">
              {semana.map((s) => (
                <div key={s.dia} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="text-[11px] tabular-nums text-slate-500">{s.total ? S(s.total).replace("S/", "") : ""}</span>
                  <div className="w-full max-w-12 rounded-t-md bg-marca-500/85 transition-all" style={{ height: `${Math.max(2, (s.total / max) * 110)}px` }} />
                  <span className="text-[11px] capitalize text-slate-500">
                    {new Date(s.dia + "T12:00:00").toLocaleDateString("es-PE", { weekday: "short", day: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><p className="card-t">Ventas recientes</p><Link href="/ventas" className="btn-ghost btn-sm">Ver todas <ArrowRight className="size-3.5" /></Link></div>
            {ventas.length === 0 ? <Empty text="Aún no hay ventas registradas" /> : (
              <table className="tbl">
                <thead><tr><th>Comprobante</th><th>Cliente</th><th>Fecha</th><th>SUNAT</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {ventas.map((v) => (
                    <tr key={v.id}>
                      <td><Link href={`/ventas/${v.id}`} className="font-medium text-marca-700 hover:underline">{comprobante(v.serie, v.numero)}</Link>
                        <span className="ml-2 text-[11px] text-slate-400">{TIPO_COMPROBANTE[v.tipo]}</span></td>
                      <td className="max-w-48 truncate">{v.clientes?.nombre}</td>
                      <td className="whitespace-nowrap text-slate-500">{fechaHora(v.fecha)}</td>
                      <td><EstadoSunat e={v.sunat_estado} /></td>
                      <td className="num font-medium">{v.tipo === "07" ? "-" : ""}{S(v.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card flex max-h-[640px] flex-col">
          <div className="card-h"><p className="card-t">Alertas del sistema</p><Link href="/digemid" className="btn-ghost btn-sm">DIGEMID <ArrowRight className="size-3.5" /></Link></div>
          <div className="flex-1 divide-y divide-slate-100 overflow-y-auto">
            {alertas.length === 0 ? <Empty text="Todo en orden. Sin alertas." /> : alertas.map((a, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-2.5">
                <span className={`${SEV[a.severidad]} mt-0.5`}>{TIPO_ALERTA[a.tipo] ?? a.tipo}</span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-slate-800">{a.titulo}</p>
                  <p className="text-xs text-slate-500">{a.detalle}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-slate-100 p-3">
            <Link href="/inventario" className="btn-secondary w-full"><PackagePlus className="size-4" />Gestionar lotes</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
