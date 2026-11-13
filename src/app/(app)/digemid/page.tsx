"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, FileArchive, Download, AlertTriangle, CheckCircle2, Printer, Info } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useApp } from "@/components/app-context";
import { PageHeader, Empty, Stat } from "@/components/ui";
import { toast } from "@/components/toast";
import { N, fecha, fechaHora, CONDICION_VENTA, hoyLima } from "@/lib/format";
import { descargar, descargarCSV } from "@/lib/csv";
import { AlertasSanitarias } from "./alertas-sanitarias";
import { Catalogo } from "./catalogo";
import { csvObservatorio, nombreArchivo, zipObservatorio } from "@/lib/observatorio";

const TABS = [["sanitarias", "Alertas sanitarias"], ["vencimientos", "Vencimientos y stock"], ["observatorio", "Observatorio de precios"], ["catalogo", "Catálogo DIGEMID"], ["libro", "Libro de recetas y controlados"]] as const;

export default function Digemid() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>(() => { try { return (sessionStorage.getItem("digemid:tab") as any) || "sanitarias"; } catch { return "sanitarias"; } });
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="DIGEMID" subtitle="Alertas sanitarias, vencimientos, Observatorio de Precios y libro de recetas" />
      <div className="mb-4 flex gap-1 border-b border-zinc-200">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => { setTab(k); try { sessionStorage.setItem("digemid:tab", k); } catch {} }} className={`-mb-px border-b-2 px-3 py-2 text-[12.5px] font-medium ${tab === k ? "border-marca-600 text-marca-700" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}>{l}</button>
        ))}
      </div>
      {tab === "sanitarias" && <AlertasSanitarias />}
      {tab === "vencimientos" && <Alertas />}
      {tab === "catalogo" && <Catalogo />}
      {tab === "observatorio" && <Observatorio />}
      {tab === "libro" && <Libro />}
    </div>
  );
}

function Alertas() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { supabaseBrowser().from("v_alertas").select("*").neq("tipo", "sunat_pendiente").then(({ data }: any) => setRows(data ?? [])); }, []);
  const grupos: [string, string, string][] = [["vencido", "Lotes vencidos con stock", "Retirar del área de dispensación, segregar y registrar la baja."],
    ["por_vencer", "Lotes por vencer", "Priorizar su venta o gestionar canje con el proveedor."],
    ["stock_bajo", "Stock bajo el mínimo", "Programar reposición."], ["sin_registro_sanitario", "Productos sin registro sanitario", "Completar el dato en la ficha del producto."]];
  return (
    <div className="grid grid-cols-2 gap-4">
      {grupos.map(([t, titulo, accion]) => {
        const items = rows.filter((r) => r.tipo === t);
        return (
          <div key={t} className="card">
            <div className="card-h"><div><p className="card-t">{titulo}</p><p className="text-xs text-zinc-500">{accion}</p></div>
              <span className={items.length ? (t === "vencido" ? "badge-red" : "badge-amber") : "badge-green"}>{items.length}</span></div>
            <div className="max-h-72 divide-y divide-zinc-100 overflow-y-auto">
              {items.length === 0 ? <p className="px-4 py-6 text-center text-[13px] text-zinc-400">Sin pendientes</p> : items.map((a, i) => (
                <div key={i} className="px-4 py-2"><p className="text-[13px] font-medium">{a.titulo}</p><p className="text-xs text-zinc-500">{a.detalle}</p></div>
              ))}
            </div>
            {items.length > 0 && t !== "sin_registro_sanitario" && <div className="border-t border-zinc-100 p-2 text-right"><Link href={t === "stock_bajo" ? "/compras/nueva" : "/inventario"} className="btn-ghost btn-sm">Gestionar</Link></div>}
          </div>
        );
      })}
    </div>
  );
}

function Observatorio() {
  const { empresa } = useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [soloConStock, setSoloConStock] = useState(false);
  const [catalogo, setCatalogo] = useState<Set<string> | null>(null);
  const codEstab = String(empresa.cod_establecimiento ?? "");

  useEffect(() => { supabaseBrowser().from("v_observatorio").select("*").order("nombre").limit(5000).then(({ data }: any) => setRows(data ?? [])); }, []);
  // Si el catálogo DIGEMID está cargado, se valida que cada CodProd exista.
  useEffect(() => {
    const codigos = [...new Set(rows.map((r) => (r.codigo_digemid ?? "").trim()).filter(Boolean))];
    if (!codigos.length) return;
    (async () => {
      const sb = supabaseBrowser();
      const { count } = await sb.from("catalogo_digemid").select("cod_prod", { count: "exact", head: true });
      if (!count) { setCatalogo(null); return; }
      const ok = new Set<string>();
      for (let i = 0; i < codigos.length; i += 200) {
        const { data } = await sb.from("catalogo_digemid").select("cod_prod").in("cod_prod", codigos.slice(i, i + 200));
        (data ?? []).forEach((d: any) => ok.add(d.cod_prod));
      }
      setCatalogo(ok);
    })();
  }, [rows]);

  const { validos, excluidos } = useMemo(() => {
    const validos: any[] = [], excluidos: { p: any; motivo: string }[] = [];
    const vistos = new Set<string>();
    for (const p of rows) {
      if (soloConStock && !(p.stock > 0)) continue;
      const cod = (p.codigo_digemid ?? "").trim();
      if (!cod) excluidos.push({ p, motivo: "Sin código DIGEMID" });
      else if (catalogo && !catalogo.has(cod)) excluidos.push({ p, motivo: "Código no existe en el catálogo cargado" });
      else if (!(Number(p.precio_unidad) > 0) && !(Number(p.precio_empaque) > 0)) excluidos.push({ p, motivo: "Sin precio" });
      else if (vistos.has(cod)) excluidos.push({ p, motivo: "Código DIGEMID repetido en otro producto" });
      else { vistos.add(cod); validos.push(p); }
    }
    return { validos, excluidos };
  }, [rows, soloConStock, catalogo]);

  function generar(formato: "csv" | "zip") {
    if (!/^\d{1,7}$/.test(codEstab)) { toast.error("Configure el código de establecimiento DIGEMID (7 dígitos) en Configuración."); return; }
    if (!validos.length) { toast.error("No hay productos válidos para reportar."); return; }
    const { csv, registros } = csvObservatorio(codEstab, validos);
    const nombre = nombreArchivo(empresa.ruc, codEstab);
    if (formato === "csv") descargar(`${nombre}.csv`, csv);
    else zipObservatorio(nombre, csv).then((b) => descargar(`${nombre}.zip`, b, "application/zip"));
    toast.ok(`Archivo generado con ${registros} productos`);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        <Stat label="Productos a reportar" value={N(validos.length)} tone="green" icon={<CheckCircle2 className="size-3.5" />} />
        <Stat label="Excluidos" value={N(excluidos.length)} tone={excluidos.length ? "amber" : "slate"} icon={<AlertTriangle className="size-3.5" />} hint="Corrija para incluirlos" />
        <Stat label="Código de establecimiento" value={codEstab ? codEstab.padStart(7, "0") : "—"} hint={codEstab ? "CodEstab" : <Link href="/configuracion" className="text-marca-700 hover:underline">Configurar</Link>} />
        <Stat label="Validación de códigos" value={catalogo ? "Activa" : "Sin catálogo"} hint={catalogo ? "Contra el catálogo DIGEMID cargado" : "Importe el catálogo en su pestaña"} />
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={() => generar("csv")}><FileSpreadsheet className="size-3.5" />Descargar CSV para el Observatorio</button>
          <button className="btn-secondary" onClick={() => generar("zip")}><FileArchive className="size-3.5" />Descargar ZIP</button>
          <label className="ml-auto flex items-center gap-2 text-[13px]"><input type="checkbox" checked={soloConStock} onChange={(e) => setSoloConStock(e.target.checked)} />Solo productos con stock</label>
        </div>
        <div className="mt-3 flex gap-2 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600">
          <Info className="size-3.5 shrink-0 text-zinc-400" />
          <p>Formato: CSV UTF-8 separado por comas con columnas <b>CodEstab, CodProd, Precio 1</b> (precio por empaque) y <b>Precio 2</b> (precio por unidad), 2 decimales.
            Súbalo en el portal del Observatorio, opción «Envío de información mediante archivo». Recuerde reportar cada vez que cambie sus precios.</p>
        </div>
      </div>

      <div className="grid grid-cols-[1.4fr_1fr] gap-4">
        <div className="card">
          <div className="card-h"><p className="card-t">Vista previa del archivo</p><span className="text-xs text-zinc-500">{validos.length} filas</span></div>
          <div className="max-h-[28rem] overflow-auto">
            <table className="tbl">
              <thead><tr><th>CodEstab</th><th>CodProd</th><th>Producto</th><th className="num">Precio 1 (empaque)</th><th className="num">Precio 2 (unidad)</th></tr></thead>
              <tbody>{validos.map((p) => (
                <tr key={p.producto_id}><td className="font-mono text-xs">{codEstab.padStart(7, "0")}</td><td className="font-mono text-xs">{p.codigo_digemid}</td>
                  <td className="max-w-64 truncate">{p.nombre} {p.concentracion} <span className="text-xs text-zinc-400">{p.presentacion}</span></td>
                  <td className="num">{Number(p.precio_empaque).toFixed(2)}</td><td className="num">{Number(p.precio_unidad).toFixed(2)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><p className="card-t">Excluidos del reporte</p></div>
          <div className="max-h-[28rem] divide-y divide-zinc-100 overflow-auto">
            {excluidos.length === 0 ? <Empty text="Todos los productos son válidos" /> : excluidos.map(({ p, motivo }) => (
              <div key={p.producto_id} className="flex items-center justify-between gap-2 px-4 py-2">
                <p className="truncate text-[13px]">{p.nombre} {p.concentracion}</p><span className="badge-amber shrink-0">{motivo}</span>
              </div>
            ))}
          </div>
          {excluidos.length > 0 && <div className="border-t border-zinc-100 p-2 text-right"><Link href="/productos" className="btn-ghost btn-sm">Corregir en Productos</Link></div>}
        </div>
      </div>
    </div>
  );
}

function Libro() {
  const sb = supabaseBrowser();
  const [desde, setDesde] = useState(hoyLima().slice(0, 8) + "01");
  const [hasta, setHasta] = useState(hoyLima());
  const [cond, setCond] = useState("controlado");
  const [rows, setRows] = useState<any[]>([]);
  const cargar = useCallback(async () => {
    let q = sb.from("v_libro_recetas").select("*").gte("fecha", `${desde}T00:00:00-05:00`).lte("fecha", `${hasta}T23:59:59-05:00`).order("fecha");
    if (cond) q = q.eq("condicion_venta", cond);
    const { data } = await q; setRows(data ?? []);
  }, [sb, desde, hasta, cond]);
  useEffect(() => { cargar(); }, [cargar]);
  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 p-3 no-print">
        <input type="date" className="input w-40" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <span className="text-zinc-400">a</span>
        <input type="date" className="input w-40" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <select className="input w-52" value={cond} onChange={(e) => setCond(e.target.value)}>
          <option value="controlado">Estupefacientes / psicotrópicos</option><option value="receta_retenida">Receta retenida</option><option value="receta">Con receta</option><option value="">Todos con receta</option>
        </select>
        <div className="ml-auto flex gap-2">
          <button className="btn-secondary" onClick={() => window.print()}><Printer className="size-3.5" />Imprimir</button>
          <button className="btn-secondary" onClick={() => descargarCSV(`libro_recetas_${desde}_${hasta}.csv`, [["Fecha", "Comprobante", "Producto", "Principio activo", "Concentración", "Lista", "Cantidad", "Lote", "N° receta", "Fecha receta", "Paciente", "DNI paciente", "Prescriptor", "CMP", "Retenida", "Dispensó"],
            ...rows.map((r) => [fechaHora(r.fecha), r.comprobante, r.producto, r.principio_activo, r.concentracion, r.lista_control, r.cantidad_unidades, r.numero_lote, r.receta_numero, r.fecha_receta, r.paciente_nombre, r.paciente_documento, r.medico_nombre, r.medico_cmp, r.retenida ? "Sí" : "No", r.dispensado_por])])}>
            <Download className="size-3.5" />Exportar</button>
        </div>
      </div>
      {rows.length === 0 ? <Empty text="Sin dispensaciones en el periodo" /> : (
        <table className="tbl text-[12.5px]">
          <thead><tr><th>Fecha</th><th>Comprobante</th><th>Producto</th><th>Lista</th><th className="num">Cant.</th><th>Lote</th><th>Receta</th><th>Paciente</th><th>Prescriptor</th><th>Retenida</th><th>Dispensó</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}><td className="whitespace-nowrap">{fechaHora(r.fecha)}</td><td><Link className="text-marca-700 hover:underline" href={`/ventas/${r.venta_id}`}>{r.comprobante}</Link></td>
              <td>{r.producto} {r.concentracion}<span className="block text-[11px] text-zinc-400">{CONDICION_VENTA[r.condicion_venta]}</span></td><td>{r.lista_control ?? "—"}</td>
              <td className="num">{r.cantidad_unidades}</td><td className="font-mono">{r.numero_lote}</td><td>{r.receta_numero || "s/n"}<span className="block text-[11px] text-zinc-400">{fecha(r.fecha_receta)}</span></td>
              <td>{r.paciente_nombre}<span className="block text-[11px] text-zinc-400">{r.paciente_documento}</span></td><td>{r.medico_nombre}<span className="block text-[11px] text-zinc-400">CMP {r.medico_cmp}</span></td>
              <td>{r.retenida ? <span className="badge-violet">Sí</span> : "No"}</td><td>{r.dispensado_por}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
