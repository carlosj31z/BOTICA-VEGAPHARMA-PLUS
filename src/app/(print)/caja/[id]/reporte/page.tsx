import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { S, fechaHora, METODO_PAGO } from "@/lib/format";
import { AutoPrint } from "../../../ventas/[id]/ticket/auto-print";

export const dynamic = "force-dynamic";

export default async function ReporteTurno({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: t } = await sb.from("turnos").select("*, cajas(nombre), perfiles(nombre)").eq("id", id).single();
  const { data: emp } = await sb.from("empresa").select("*").eq("id", 1).single();
  if (!t) notFound();
  const r = t.resumen ?? (await sb.rpc("resumen_turno", { p_turno_id: Number(id) })).data ?? {};
  return (
    <div className="mx-auto w-[300px] p-3 font-mono text-[11px] leading-[1.4]">
      <AutoPrint />
      <style>{`@page { size: 80mm auto; margin: 3mm; }`}</style>
      <p className="text-center text-[13px] font-bold">{emp?.nombre_comercial || emp?.razon_social}</p>
      <p className="mb-2 border-y border-dashed border-black py-1 text-center font-bold">REPORTE DE CIERRE DE CAJA</p>
      <p>{t.cajas?.nombre} · Turno #{t.id}</p>
      <p>Cajero: {t.perfiles?.nombre}</p>
      <p>Apertura: {fechaHora(t.abierto_at)}</p>
      <p>Cierre: {fechaHora(t.cerrado_at)}</p>
      <div className="mt-2 border-t border-dashed border-black pt-1">
        <R l="Comprobantes" r={String(r.ventas ?? 0)} />
        <R l="Ventas brutas" r={S(r.total_ventas)} />
        <R l="Devoluciones (NC)" r={S(r.devoluciones)} />
        <R l="Venta neta" r={S(r.neto)} b />
      </div>
      <div className="mt-2 border-t border-dashed border-black pt-1">
        {Object.entries(METODO_PAGO).map(([k, l]) => <R key={k} l={l} r={S(r.por_metodo?.[k] ?? 0)} />)}
      </div>
      <div className="mt-2 border-t border-dashed border-black pt-1">
        <R l="Monto apertura" r={S(r.monto_apertura)} />
        <R l="Ingresos" r={S(r.ingresos)} />
        <R l="Egresos" r={S(r.egresos)} />
        <R l="Efectivo esperado" r={S(t.efectivo_esperado ?? r.efectivo_esperado)} b />
        <R l="Efectivo contado" r={S(t.efectivo_contado)} b />
        <R l="Diferencia" r={S(t.diferencia)} b />
      </div>
      {t.observacion && <p className="mt-2">Obs.: {t.observacion}</p>}
      <div className="mt-10 grid grid-cols-2 gap-4 text-center text-[10px]"><p className="border-t border-black pt-1">Cajero</p><p className="border-t border-black pt-1">Supervisor</p></div>
    </div>
  );
}
function R({ l, r, b }: { l: string; r: string; b?: boolean }) {
  return <div className={`flex justify-between ${b ? "font-bold" : ""}`}><span>{l}</span><span>{r}</span></div>;
}
