"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, Square, TrendingDown, TrendingUp, Minus, Search } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useApp } from "@/components/app-context";
import { Stat, Empty } from "@/components/ui";
import { toast } from "@/components/toast";
import { N, fechaHora } from "@/lib/format";

const S = (n: any) => (n == null || n === "" ? "—" : `S/ ${Number(n).toFixed(2)}`);
type Filtro = "todos" | "caros" | "baratos" | "sin_datos";

/** Compara los precios de la botica con los del Observatorio (boticas privadas del distrito o provincia). */
export function PreciosMercado() {
  const { empresa, perfil } = useApp();
  const puede = ["admin", "quimico"].includes(perfil.rol);
  const [rows, setRows] = useState<any[] | null>(null);
  const [sinc, setSinc] = useState<{ hechos: number; total: number } | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [q, setQ] = useState("");
  const parar = useRef(false);

  const cargar = () => supabaseBrowser().from("v_precios_mercado").select("*").order("nombre").limit(5000).then(({ data, error }: any) => {
    if (error) { toast.error(error.message); setRows([]); } else setRows(data ?? []);
  });
  useEffect(() => { cargar(); }, []);

  async function sincronizar(soloPendientes: boolean, ids?: number[]) {
    if (!/^\d{6}$/.test(String(empresa.ubigeo ?? ""))) { toast.error("Configure el ubigeo del establecimiento (6 dígitos) en Configuración."); return; }
    parar.current = false;
    const objetivo = ids ?? (soloPendientes ? (rows ?? []).filter((r) => !r.consultado_at).map((r) => r.producto_id) : (rows ?? []).map((r) => r.producto_id));
    if (!objetivo.length) { toast.ok("No hay productos pendientes de consultar."); return; }
    setSinc({ hechos: 0, total: objetivo.length });
    let hechos = 0, conPrecios = 0;
    for (let i = 0; i < objetivo.length && !parar.current; i += 10) {
      const lote = objetivo.slice(i, i + 10);
      const r = await fetch("/api/digemid/precios", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: lote, limite: lote.length }) }).catch(() => null);
      const d = await r?.json().catch(() => ({}));
      if (!r?.ok) { toast.error(d?.error ?? "No se pudo consultar el Observatorio."); break; }
      hechos += d.procesados ?? 0; conPrecios += d.con_precios ?? 0;
      setSinc({ hechos, total: objetivo.length });
      if (d.aviso) { toast.error(d.aviso); break; }
      if (!d.procesados) break;
      await cargar();
    }
    setSinc(null);
    await cargar();
    if (hechos) toast.ok(`${hechos} productos consultados, ${conPrecios} con precios en su zona.`);
  }

  const lista = useMemo(() => (rows ?? []).filter((r) => {
    if (q && !`${r.nombre} ${r.principio_activo ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filtro === "caros") return r.dif_mediana_pct > 10;
    if (filtro === "baratos") return r.dif_mediana_pct < -10;
    if (filtro === "sin_datos") return !r.consultado_at || (!r.n_exacto && !r.n_equivalentes);
    return true;
  }), [rows, filtro, q]);

  const consultados = (rows ?? []).filter((r) => r.consultado_at).length;
  const caros = (rows ?? []).filter((r) => r.dif_mediana_pct > 10).length;
  const baratos = (rows ?? []).filter((r) => r.dif_mediana_pct < -10).length;
  const ultima = (rows ?? []).reduce<string | null>((m, r) => (r.consultado_at && (!m || r.consultado_at > m) ? r.consultado_at : m), null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Consultados" value={`${N(consultados)} / ${N(rows?.length ?? 0)}`} hint={ultima ? `Última: ${fechaHora(ultima)}` : "Aún sin consultar"} />
        <Stat label="Más caros que la zona" value={N(caros)} tone={caros ? "amber" : "slate"} hint="Más de 10% sobre la mediana" />
        <Stat label="Más baratos que la zona" value={N(baratos)} tone="green" hint="Más de 10% bajo la mediana" />
        <Stat label="Zona de comparación" value={empresa.ubigeo || "—"} hint={empresa.ubigeo ? [empresa.distrito, empresa.provincia].filter(Boolean).join(", ") || "Ubigeo" : <Link href="/configuracion" className="text-marca-700 hover:underline">Configurar ubigeo</Link>} />
      </div>

      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          {puede && !sinc && <>
            <button className="btn-primary" onClick={() => sincronizar(true)}><RefreshCw className="size-3.5" />Sincronizar con el Observatorio</button>
            {consultados > 0 && <button className="btn-secondary" onClick={() => sincronizar(false)}>Actualizar todos</button>}
          </>}
          {sinc && <>
            <div className="flex items-center gap-2 text-[13px] text-zinc-600">
              <RefreshCw className="size-3.5 animate-spin" />Consultando {sinc.hechos} de {sinc.total}…
              <div className="h-1.5 w-40 overflow-hidden rounded bg-zinc-100"><div className="h-full bg-marca-600 transition-all" style={{ width: `${(sinc.hechos / sinc.total) * 100}%` }} /></div>
            </div>
            <button className="btn-secondary btn-sm" onClick={() => { parar.current = true; }}><Square className="size-3" />Detener</button>
          </>}
          <div className="seg ml-auto">
            {([["todos", "Todos"], ["caros", "Más caros"], ["baratos", "Más baratos"], ["sin_datos", "Sin datos"]] as [Filtro, string][]).map(([k, l]) =>
              <button key={k} data-on={filtro === k} onClick={() => setFiltro(k)}>{l}</button>)}
          </div>
          <div className="relative"><Search className="absolute left-2 top-2 size-3.5 text-zinc-400" /><input className="input w-52 pl-7" placeholder="Buscar producto" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        <p className="mt-2 text-[11.5px] text-zinc-500">Precios que reportan las boticas y farmacias privadas de su distrito al Observatorio de DIGEMID (si hay pocas, de su provincia). Se actualiza un lote cada día de forma automática.</p>
      </div>

      <div className="card overflow-hidden">
        <div className="max-h-[32rem] overflow-auto">
          {rows === null ? <Empty text="Cargando…" /> : lista.length === 0 ? <Empty text="Sin productos para mostrar" /> : (
            <table className="tbl">
              <thead><tr><th>Producto</th><th className="num">Mi precio (unid.)</th><th className="num">Mín.</th><th className="num">Mediana</th><th className="num">Máx.</th><th>Posición</th><th className="num">Boticas</th><th>Genérico más barato</th><th>Consulta</th>{puede && <th />}</tr></thead>
              <tbody>{lista.map((r) => {
                const d = r.dif_mediana_pct;
                return (
                  <tr key={r.producto_id}>
                    <td className="max-w-64"><p className="truncate">{r.nombre} {r.concentracion}</p>{r.error && <p className="truncate text-[11px] text-zinc-400">{r.error}</p>}</td>
                    <td className="num font-medium">{S(r.precio_unidad)}</td>
                    <td className="num">{S(r.unidad_min)}</td><td className="num">{S(r.unidad_mediana)}</td><td className="num">{S(r.unidad_max)}</td>
                    <td>{d == null ? <span className="text-zinc-300">—</span>
                      : d > 10 ? <span className="badge-amber"><TrendingUp className="mr-0.5 inline size-3" />+{d}%</span>
                      : d < -10 ? <span className="badge-green"><TrendingDown className="mr-0.5 inline size-3" />{d}%</span>
                      : <span className="badge-gray"><Minus className="mr-0.5 inline size-3" />{d > 0 ? "+" : ""}{d}%</span>}</td>
                    <td className="num">{r.consultado_at ? `${r.n_exacto}${r.ambito === "provincia" ? " (prov.)" : ""}` : ""}</td>
                    <td className="max-w-60 truncate text-[12px] text-zinc-600" title={r.equiv_mas_barato ?? ""}>{r.equiv_mas_barato ?? ""}</td>
                    <td className="whitespace-nowrap text-[11.5px] text-zinc-500">{r.consultado_at ? fechaHora(r.consultado_at) : "Pendiente"}</td>
                    {puede && <td><button className="btn-ghost btn-sm" disabled={!!sinc} onClick={() => sincronizar(false, [r.producto_id])} title="Consultar este producto"><RefreshCw className="size-3" /></button></td>}
                  </tr>
                );
              })}</tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
