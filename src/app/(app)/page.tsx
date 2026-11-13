"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ShoppingCart, Truck, ArrowRight } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PageHeader, Empty } from "@/components/ui";
import clsx from "clsx";
import { S, fechaHora, comprobante, TIPO_COMPROBANTE } from "@/lib/format";
import { useApp } from "@/components/app-context";
import { EstadoSunat } from "@/components/estado-sunat";

const TIPO_ALERTA: Record<string, string> = {
  vencido: "Vencido", por_vencer: "Por vencer", stock_bajo: "Stock bajo", sunat_pendiente: "SUNAT", sin_registro_sanitario: "Reg. sanitario", alerta_digemid: "DIGEMID",
};

export default function Tablero() {
  const { perfil } = useApp();
  const [t, setT] = useState<any>(null);
  const [alertas, setAlertas] = useState<any[]>([]);
  const [ventas, setVentas] = useState<any[]>([]);
  const [filtro, setFiltro] = useState("");
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
  const conteo = alertas.reduce((m: Record<string, number>, a) => ({ ...m, [a.tipo]: (m[a.tipo] ?? 0) + 1 }), {});

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title={`Hola, ${perfil.nombre.split(" ").find((w) => !w.endsWith(".")) ?? perfil.nombre}`} subtitle="Resumen de la operación de hoy"
        actions={<>
          <Link href="/compras/nueva" className="btn-secondary"><Truck className="size-3.5" />Registrar compra</Link>
          <Link href="/pos" className="btn-primary"><ShoppingCart className="size-3.5" />Nueva venta <span className="ml-1 text-[11px] text-white/60">F1</span></Link>
        </>} />

      <div className="card grid grid-cols-4 divide-x divide-zinc-100">
        {[
          { l: "Venta de hoy", v: S(t?.ventas_hoy), h: `${t?.tickets_hoy ?? 0} comprobantes` },
          { l: "Turnos abiertos", v: t?.turnos_abiertos ?? "—", h: "Cajas en operación" },
          { l: "Pendientes SUNAT", v: t?.pendientes_sunat ?? "—", h: "Por enviar o rechazados", href: "/sunat", warn: !!t?.pendientes_sunat },
          { l: "Alertas", v: alertas.length, h: `${alta} de prioridad alta`, href: "/digemid", warn: alta > 0 },
        ].map((k) => {
          const body = (<>
            <p className="text-[11.5px] text-zinc-500">{k.l}</p>
            <p className={clsx("text-[20px] font-semibold tabular-nums tracking-tight", k.warn ? "text-rose-600" : "text-zinc-900")}>{k.v}</p>
            <p className="text-[11.5px] text-zinc-400">{k.h}</p>
          </>);
          return k.href
            ? <Link key={k.l} href={k.href} className="px-4 py-3 hover:bg-zinc-50">{body}</Link>
            : <div key={k.l} className="px-4 py-3">{body}</div>;
        })}
      </div>

      <div className="mt-4 grid grid-cols-[1.6fr_1fr] gap-4">
        <div className="space-y-4">
          <div className="card">
            <div className="card-h"><p className="card-t">Ventas de los últimos 7 días</p></div>
            <div className="flex h-40 items-end gap-3 px-5 pb-3 pt-5">
              {semana.map((s, i) => (
                <div key={s.dia} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="text-[11px] tabular-nums text-zinc-500">{s.total ? S(s.total).replace("S/", "") : ""}</span>
                  <div className={clsx("w-full max-w-12 rounded-t-sm", i === semana.length - 1 ? "bg-marca-600" : "bg-zinc-300")} style={{ height: `${Math.max(2, (s.total / max) * 110)}px` }} />
                  <span className="text-[11px] capitalize text-zinc-500">
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
                      <td><Link href={`/ventas/${v.id}`} className="font-medium text-zinc-900 hover:underline">{comprobante(v.serie, v.numero)}</Link>
                        <span className="ml-2 text-[11px] text-zinc-400">{TIPO_COMPROBANTE[v.tipo]}</span></td>
                      <td className="max-w-48 truncate">{v.clientes?.nombre}</td>
                      <td className="whitespace-nowrap text-zinc-500">{fechaHora(v.fecha)}</td>
                      <td><EstadoSunat e={v.sunat_estado} /></td>
                      <td className="num font-medium">{v.tipo === "07" ? "-" : ""}{S(v.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card flex max-h-[600px] flex-col">
          <div className="card-h"><p className="card-t">Alertas</p><Link href="/digemid" className="btn-ghost btn-sm">DIGEMID <ArrowRight className="size-3.5" /></Link></div>
          {alertas.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-b border-zinc-100 px-4 py-2">
              <button onClick={() => setFiltro("")} className={clsx("rounded-full px-2.5 py-0.5 text-[11.5px]", !filtro ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200")}>Todas {alertas.length}</button>
              {Object.entries(conteo).map(([k, n]) => (
                <button key={k} onClick={() => setFiltro(k)} className={clsx("rounded-full px-2.5 py-0.5 text-[11.5px]", filtro === k ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200")}>
                  {TIPO_ALERTA[k] ?? k} {String(n)}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {alertas.length === 0 ? <Empty text="Todo en orden. Sin alertas." /> : alertas.filter((a) => !filtro || a.tipo === filtro).map((a, i) => (
              <div key={i} className="flex items-start gap-2.5 border-b border-zinc-50 px-4 py-2">
                <span className={clsx("mt-1.5 size-1.5 shrink-0 rounded-full", a.severidad === "alta" ? "bg-rose-500" : a.severidad === "media" ? "bg-amber-400" : "bg-zinc-300")} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium text-zinc-800">{a.titulo}</p>
                  <p className="truncate text-[11.5px] text-zinc-500">{a.detalle}</p>
                </div>
                <span className="shrink-0 text-[11px] text-zinc-400">{TIPO_ALERTA[a.tipo] ?? a.tipo}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
