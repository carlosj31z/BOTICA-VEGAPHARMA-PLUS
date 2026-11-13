"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, Send, FileDown, FileCode2, ShieldCheck, AlertTriangle } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PageHeader, Empty, Spinner, Stat } from "@/components/ui";
import { EstadoSunat } from "@/components/estado-sunat";
import { toast } from "@/components/toast";
import { S, fechaHora, comprobante, TIPO_COMPROBANTE } from "@/lib/format";

export default function Sunat() {
  const sb = supabaseBrowser();
  const [filtro, setFiltro] = useState("pendientes");
  const [rows, setRows] = useState<any[]>([]);
  const [conteo, setConteo] = useState<Record<string, number>>({});
  const [cfg, setCfg] = useState<{ configurado: boolean; proveedor: string | null } | null>(null);
  const [enviando, setEnviando] = useState<number | "todos" | null>(null);

  const cargar = useCallback(async () => {
    let q = sb.from("ventas").select("id,tipo,serie,numero,fecha,total,sunat_estado,sunat_mensaje,sunat_intentos,sunat_pdf_url,sunat_xml_url,sunat_cdr_url,clientes(nombre)")
      .neq("tipo", "NV").order("fecha", { ascending: false }).limit(500);
    if (filtro === "pendientes") q = q.in("sunat_estado", ["pendiente", "enviado", "error"]);
    else if (filtro === "rechazados") q = q.in("sunat_estado", ["rechazado", "observado"]);
    else if (filtro === "aceptados") q = q.eq("sunat_estado", "aceptado");
    const { data } = await q; setRows(data ?? []);
    const { data: all } = await sb.from("ventas").select("sunat_estado").neq("tipo", "NV").gte("fecha", new Date(Date.now() - 31 * 864e5).toISOString());
    const c: Record<string, number> = {}; (all ?? []).forEach((v: any) => { c[v.sunat_estado] = (c[v.sunat_estado] ?? 0) + 1; }); setConteo(c);
  }, [sb, filtro]);
  useEffect(() => { cargar(); fetch("/api/sunat/estado").then((r) => r.json()).then(setCfg).catch(() => {}); }, [cargar]);

  async function enviar(id: number) {
    setEnviando(id);
    const r = await fetch("/api/sunat/enviar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ venta_id: id }) });
    const j = await r.json().catch(() => ({})); setEnviando(null);
    if (r.ok) toast.ok(j.mensaje); else toast.error(j.error ?? "Error");
    cargar();
  }
  async function reenviarTodos() {
    setEnviando("todos");
    const r = await fetch("/api/sunat/reintentar", { method: "POST" });
    const j = await r.json().catch(() => ({})); setEnviando(null);
    if (r.ok) toast.ok(`${j.aceptados} de ${j.procesados} comprobantes enviados correctamente`); else toast.error(j.error ?? "Error");
    cargar();
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Comprobantes electrónicos SUNAT" subtitle="Seguimiento del envío de boletas, facturas y notas de crédito"
        actions={<button className="btn-primary" onClick={reenviarTodos} disabled={enviando !== null || !cfg?.configurado}>{enviando === "todos" ? <Spinner /> : <RefreshCw className="size-4" />}Reenviar pendientes</button>} />
      {cfg && !cfg.configurado && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div><p className="font-semibold">Facturación electrónica aún no conectada</p>
            <p>Las ventas se registran con normalidad y quedan como «pendiente». Cuando se configure el proveedor (variables NUBEFACT_RUTA y NUBEFACT_TOKEN en Vercel), use «Reenviar pendientes».</p></div>
        </div>
      )}
      {cfg?.configurado && <p className="mb-3 flex items-center gap-1.5 text-[13px] text-emerald-700"><ShieldCheck className="size-4" />Conectado con {cfg.proveedor}</p>}
      <div className="mb-4 grid grid-cols-4 gap-4">
        <Stat label="Aceptados (31 días)" value={conteo.aceptado ?? 0} tone="green" />
        <Stat label="Pendientes / en proceso" value={(conteo.pendiente ?? 0) + (conteo.enviado ?? 0)} tone="amber" />
        <Stat label="Con error" value={conteo.error ?? 0} tone={conteo.error ? "red" : "slate"} />
        <Stat label="Rechazados / observados" value={(conteo.rechazado ?? 0) + (conteo.observado ?? 0)} tone={conteo.rechazado ? "red" : "slate"} />
      </div>
      <div className="card">
        <div className="flex gap-1 border-b border-slate-100 p-3">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-[12.5px]">
            {[["pendientes", "Pendientes"], ["rechazados", "Rechazados / observados"], ["aceptados", "Aceptados"], ["todos", "Todos"]].map(([k, l]) => (
              <button key={k} onClick={() => setFiltro(k)} className={`rounded-md px-2.5 py-1 ${filtro === k ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}>{l}</button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? <Empty text="No hay comprobantes en esta vista" /> : (
          <table className="tbl">
            <thead><tr><th>Comprobante</th><th>Tipo</th><th>Fecha</th><th>Cliente</th><th className="num">Total</th><th>Estado</th><th>Respuesta</th><th className="num">Intentos</th><th /></tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td><Link href={`/ventas/${v.id}`} className="font-medium text-marca-700 hover:underline">{comprobante(v.serie, v.numero)}</Link></td>
                  <td>{TIPO_COMPROBANTE[v.tipo]}</td><td className="text-slate-500">{fechaHora(v.fecha)}</td>
                  <td className="max-w-48 truncate">{v.clientes?.nombre}</td><td className="num">{S(v.total)}</td>
                  <td><EstadoSunat e={v.sunat_estado} /></td>
                  <td className="max-w-72 truncate text-xs text-slate-500" title={v.sunat_mensaje}>{v.sunat_mensaje ?? "—"}</td>
                  <td className="num">{v.sunat_intentos}</td>
                  <td className="whitespace-nowrap">
                    {v.sunat_pdf_url && <a className="btn-ghost btn-sm" href={v.sunat_pdf_url} target="_blank" title="PDF"><FileDown className="size-3.5" /></a>}
                    {v.sunat_xml_url && <a className="btn-ghost btn-sm" href={v.sunat_xml_url} target="_blank" title="XML"><FileCode2 className="size-3.5" /></a>}
                    {!["aceptado", "anulado"].includes(v.sunat_estado) && <button className="btn-ghost btn-sm" disabled={enviando !== null || !cfg?.configurado} onClick={() => enviar(v.id)}>
                      {enviando === v.id ? <Spinner className="size-3.5" /> : <Send className="size-3.5" />}Enviar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
