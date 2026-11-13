"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search, Download, Printer } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PageHeader, Empty, Spinner } from "@/components/ui";
import { EstadoSunat } from "@/components/estado-sunat";
import { S, fechaHora, comprobante, TIPO_COMPROBANTE, METODO_PAGO, hoyLima } from "@/lib/format";
import { descargarCSV } from "@/lib/csv";

export default function Ventas() {
  const sb = supabaseBrowser();
  const [desde, setDesde] = useState(hoyLima());
  const [hasta, setHasta] = useState(hoyLima());
  const [tipo, setTipo] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    let query = sb.from("ventas").select("id,tipo,serie,numero,fecha,total,igv,sunat_estado,anulada,clientes(nombre,numero_documento),perfiles(nombre),pagos(metodo,monto)")
      .gte("fecha", `${desde}T00:00:00-05:00`).lte("fecha", `${hasta}T23:59:59-05:00`).order("fecha", { ascending: false }).limit(1000);
    if (tipo) query = query.eq("tipo", tipo);
    const { data } = await query;
    setRows(data ?? []); setCargando(false);
  }, [sb, desde, hasta, tipo]);
  useEffect(() => { cargar(); }, [cargar]);

  const filtradas = rows.filter((v) => !q || comprobante(v.serie, v.numero).includes(q.toUpperCase()) ||
    v.clientes?.nombre?.toUpperCase().includes(q.toUpperCase()) || v.clientes?.numero_documento?.includes(q));
  const total = filtradas.filter((v) => !v.anulada).reduce((a, v) => a + (v.tipo === "07" ? -1 : 1) * Number(v.total), 0);

  function exportar() {
    descargarCSV(`ventas_${desde}_${hasta}.csv`, [
      ["Fecha", "Tipo", "Comprobante", "Cliente", "Documento", "IGV", "Total", "Medios de pago", "Estado SUNAT", "Anulada", "Usuario"],
      ...filtradas.map((v) => [fechaHora(v.fecha), TIPO_COMPROBANTE[v.tipo], comprobante(v.serie, v.numero), v.clientes?.nombre, v.clientes?.numero_documento,
        v.igv, (v.tipo === "07" ? -1 : 1) * v.total, (v.pagos ?? []).map((p: any) => METODO_PAGO[p.metodo]).join(" + "), v.sunat_estado, v.anulada ? "Sí" : "", v.perfiles?.nombre]),
    ]);
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Historial de ventas" subtitle={`${filtradas.length} comprobantes · venta neta ${S(total)}`}
        actions={<button className="btn-secondary" onClick={exportar}><Download className="size-3.5" />Exportar CSV</button>} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 p-3">
          <input type="date" className="input w-40" value={desde} onChange={(e) => setDesde(e.target.value)} />
          <span className="text-zinc-400">a</span>
          <input type="date" className="input w-40" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          <select className="input w-44" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos los tipos</option>{Object.entries(TIPO_COMPROBANTE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <div className="relative ml-auto w-72"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input className="input pl-8" placeholder="Comprobante, cliente o documento" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {cargando && <Spinner />}
        </div>
        {filtradas.length === 0 ? <Empty /> : (
          <table className="tbl">
            <thead><tr><th>Comprobante</th><th>Tipo</th><th>Fecha</th><th>Cliente</th><th>Pago</th><th>Usuario</th><th>SUNAT</th><th className="num">Total</th><th /></tr></thead>
            <tbody>
              {filtradas.map((v) => (
                <tr key={v.id} className={v.anulada ? "opacity-50" : ""}>
                  <td><Link href={`/ventas/${v.id}`} className="font-medium text-marca-700 hover:underline">{comprobante(v.serie, v.numero)}</Link></td>
                  <td>{TIPO_COMPROBANTE[v.tipo]}{v.anulada && <span className="badge-red ml-1">Anulada</span>}</td>
                  <td className="whitespace-nowrap text-zinc-500">{fechaHora(v.fecha)}</td>
                  <td className="max-w-56 truncate">{v.clientes?.nombre}</td>
                  <td className="text-xs text-zinc-500">{(v.pagos ?? []).map((p: any) => METODO_PAGO[p.metodo]).join(" + ")}</td>
                  <td className="text-zinc-500">{v.perfiles?.nombre}</td>
                  <td><EstadoSunat e={v.sunat_estado} /></td>
                  <td className="num font-medium">{v.tipo === "07" ? "-" : ""}{S(v.total)}</td>
                  <td><button className="btn-ghost btn-sm" title="Reimprimir" onClick={() => window.open(`/ventas/${v.id}/ticket`, "ticket", "width=420,height=700")}><Printer className="size-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
