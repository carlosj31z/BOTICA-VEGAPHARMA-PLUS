"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Upload, Link2, Check, Search } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useApp } from "@/components/app-context";
import { Empty, Spinner } from "@/components/ui";
import { toast } from "@/components/toast";
import { N, fechaHora, errorMsg } from "@/lib/format";

/** Columnas del catálogo de productos farmacéuticos de DIGEMID (los nombres varían entre versiones). */
const MAPA: Record<string, string[]> = {
  cod_prod: ["codprod", "codigoproducto", "codigo", "cod"],
  nombre: ["nomprod", "nombreproducto", "producto", "nombre"],
  concentracion: ["concent", "concentracion"],
  forma_farmaceutica: ["nomformfarm", "formafarmaceutica", "formafarm", "forma"],
  presentacion: ["presentac", "presentacion"],
  fraccion: ["fraccion", "fracc"],
  registro_sanitario: ["numregsan", "registrosanitario", "regsan", "numregistro"],
  titular: ["nomtitular", "titular"],
  fabricante: ["nomfabricante", "fabricante"],
  principio_activo: ["nomifa", "ifa", "principioactivo", "dci"],
  situacion: ["situacion", "estado"],
};
const clave = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

function parseCSV(texto: string): string[][] {
  const primera = texto.slice(0, texto.indexOf("\n"));
  const sep = [";", "\t", ","].sort((a, b) => primera.split(b).length - primera.split(a).length)[0];
  const filas: string[][] = []; let fila: string[] = []; let campo = ""; let q = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (q) { if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else q = false; } else campo += c; }
    else if (c === '"') q = true;
    else if (c === sep) { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && texto[i + 1] === "\n") i++; fila.push(campo); filas.push(fila); fila = []; campo = ""; }
    else campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.some((x) => x.trim()));
}

export function Catalogo() {
  const { puede } = useApp();
  const sb = supabaseBrowser();
  const [info, setInfo] = useState<{ total: number; ultima: string | null } | null>(null);
  const [progreso, setProgreso] = useState<string>("");

  const cargarInfo = useCallback(async () => {
    const [{ count }, { data }] = await Promise.all([
      sb.from("catalogo_digemid").select("cod_prod", { count: "exact", head: true }),
      sb.from("catalogo_digemid").select("actualizado_at").order("actualizado_at", { ascending: false }).limit(1),
    ]);
    setInfo({ total: count ?? 0, ultima: data?.[0]?.actualizado_at ?? null });
  }, [sb]);
  useEffect(() => { cargarInfo(); }, [cargarInfo]);

  async function importar(file: File) {
    try {
      setProgreso("Leyendo archivo…");
      let filas: unknown[][];
      if (/\.xlsx$/i.test(file.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        filas = (await readSheet(file)) as unknown as unknown[][];
      } else {
        const buf = await file.arrayBuffer();
        let texto = new TextDecoder("utf-8").decode(buf);
        if (texto.includes("�")) texto = new TextDecoder("windows-1252").decode(buf);
        filas = parseCSV(texto.replace(/^﻿/, ""));
      }
      // La cabecera puede no estar en la primera fila (títulos arriba): se busca la fila que tenga el código.
      const iCab = filas.findIndex((f) => f.some((c) => MAPA.cod_prod.includes(clave(c))) && f.some((c) => MAPA.nombre.includes(clave(c))));
      if (iCab < 0) throw new Error("No se encontró la cabecera (Cod_Prod, Nom_Prod…). Use el catálogo descargado de DIGEMID.");
      const cab = filas[iCab].map(clave);
      const idx = Object.fromEntries(Object.entries(MAPA).map(([k, alias]) => [k, cab.findIndex((c) => alias.includes(c))]));
      const vistos = new Map<string, any>();
      for (const f of filas.slice(iCab + 1)) {
        const v = (k: string) => (idx[k] >= 0 ? String(f[idx[k]] ?? "").trim() : "");
        const cod = v("cod_prod").replace(/\.0$/, "");
        if (!cod || !v("nombre")) continue;
        vistos.set(cod, {
          cod_prod: cod, nombre: v("nombre"), concentracion: v("concentracion") || null, forma_farmaceutica: v("forma_farmaceutica") || null,
          presentacion: v("presentacion") || null, fraccion: parseInt(v("fraccion")) || null, registro_sanitario: v("registro_sanitario") || null,
          titular: v("titular") || null, fabricante: v("fabricante") || null, principio_activo: v("principio_activo") || null,
          situacion: v("situacion") || null, actualizado_at: new Date().toISOString(),
        });
      }
      const regs = [...vistos.values()];
      if (!regs.length) throw new Error("El archivo no tiene productos.");
      for (let i = 0; i < regs.length; i += 1000) {
        setProgreso(`Guardando ${N(Math.min(i + 1000, regs.length))} de ${N(regs.length)}…`);
        const { error } = await sb.from("catalogo_digemid").upsert(regs.slice(i, i + 1000), { onConflict: "cod_prod" });
        if (error) throw error;
      }
      toast.ok(`Catálogo actualizado: ${N(regs.length)} productos`);
      cargarInfo();
    } catch (e: any) {
      toast.error(errorMsg(e) || e?.message);
    } finally { setProgreso(""); }
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-4 p-4">
        <div className="min-w-0 flex-1">
          <p className="card-t">Catálogo de productos farmacéuticos</p>
          <p className="text-[12px] text-zinc-500">
            {info === null ? "…" : info.total ? <>{N(info.total)} productos · actualizado {info.ultima ? fechaHora(info.ultima) : "—"}</> : "Aún no cargado"}.
            {" "}Descárguelo del Observatorio de Precios (Catálogo de productos, Excel o CSV) y súbalo aquí. Sirve para obtener el <b>CodProd</b> de cada producto.
          </p>
        </div>
        {puede("admin", "quimico", "almacen") && (
          <label className={clsx("btn-primary cursor-pointer", progreso && "pointer-events-none opacity-60")}>
            {progreso ? <Spinner /> : <Upload className="size-3.5" />}{progreso || "Importar catálogo (.xlsx / .csv)"}
            <input type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importar(f); }} />
          </label>
        )}
      </div>
      {!!info?.total && <Vincular />}
    </div>
  );
}

/** Asistente: sugiere el código DIGEMID para productos que aún no lo tienen. */
function Vincular() {
  const sb = supabaseBrowser();
  const [productos, setProductos] = useState<any[] | null>(null);
  const [sel, setSel] = useState<any>(null);
  const [sug, setSug] = useState<any[] | null>(null);
  const [q, setQ] = useState("");

  const cargar = useCallback(() => {
    sb.from("productos").select("id,nombre,concentracion,forma_farmaceutica,presentacion,registro_sanitario,principio_activo,unidades_por_empaque")
      .eq("activo", true).or("codigo_digemid.is.null,codigo_digemid.eq.").order("nombre").limit(1000)
      .then(({ data }: any) => { setProductos(data ?? []); setSel((s: any) => (data ?? []).find((p: any) => p.id === s?.id) ?? data?.[0] ?? null); });
  }, [sb]);
  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    if (!sel) { setSug([]); return; }
    setSug(null);
    if (q.trim().length >= 3) {
      const t = setTimeout(() => sb.rpc("buscar_catalogo", { p_texto: q, p_limite: 15 }).then(({ data }: any) => setSug(data ?? [])), 250);
      return () => clearTimeout(t);
    }
    sb.rpc("sugerir_codigos", { p_producto_id: sel.id, p_limite: 8 }).then(({ data }: any) => setSug(data ?? []));
  }, [sel, q, sb]);

  async function asignar(cod: string) {
    const { error } = await sb.from("productos").update({ codigo_digemid: cod }).eq("id", sel.id);
    if (error) { toast.error(errorMsg(error)); return; }
    toast.ok(`${sel.nombre} vinculado a ${cod}`);
    setQ("");
    const resto = (productos ?? []).filter((p) => p.id !== sel.id);
    setProductos(resto); setSel(resto[(productos ?? []).findIndex((p) => p.id === sel.id)] ?? resto[0] ?? null);
  }

  if (!productos) return <div className="py-8 text-center"><Spinner /></div>;
  if (!productos.length) return <div className="card"><Empty text="Todos los productos activos tienen código DIGEMID." icon={<Check className="size-6 text-emerald-500" />} /></div>;

  return (
    <div className="card grid min-h-[420px] grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] divide-x divide-zinc-100">
      <div className="max-h-[65vh] overflow-y-auto">
        <div className="sticky top-0 border-b border-zinc-100 bg-white px-4 py-2.5">
          <p className="card-t flex items-center gap-1.5"><Link2 className="size-3.5" />Vincular códigos DIGEMID</p>
          <p className="text-[11.5px] text-zinc-500">{productos.length} productos sin código</p>
        </div>
        {productos.map((p) => (
          <button key={p.id} onClick={() => { setSel(p); setQ(""); }} className={clsx("block w-full border-b border-zinc-50 px-4 py-2 text-left text-[12.5px] hover:bg-zinc-50", sel?.id === p.id && "bg-marca-50/60")}>
            <p className="truncate font-medium text-zinc-900">{p.nombre} {p.concentracion}</p>
            <p className="truncate text-[11.5px] text-zinc-500">{[p.forma_farmaceutica, p.presentacion, p.registro_sanitario].filter(Boolean).join(" · ") || "—"}</p>
          </button>
        ))}
      </div>
      <div className="max-h-[65vh] overflow-y-auto">
        {sel && (
          <>
            <div className="sticky top-0 border-b border-zinc-100 bg-white px-4 py-2.5">
              <p className="text-[13px] font-semibold text-zinc-900">{sel.nombre} {sel.concentracion}</p>
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
                <input className="input pl-8" placeholder="Buscar otro nombre en el catálogo…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
            {sug === null ? <div className="py-8 text-center"><Spinner /></div> : sug.length === 0 ? <Empty text="Sin coincidencias. Pruebe buscando por otro nombre." /> : (
              <table className="tbl">
                <thead><tr><th>CodProd</th><th>Producto en catálogo</th><th>Reg. sanitario</th><th className="num">Fracc.</th><th /></tr></thead>
                <tbody>
                  {sug.map((c) => (
                    <tr key={c.cod_prod}>
                      <td className="font-mono text-[12px]">{c.cod_prod}</td>
                      <td><p className="font-medium">{c.nombre} {c.concentracion}</p><p className="text-[11.5px] text-zinc-500">{[c.forma_farmaceutica, c.presentacion, c.titular].filter(Boolean).join(" · ")}</p></td>
                      <td className={clsx("text-[12px]", sel.registro_sanitario && c.registro_sanitario === sel.registro_sanitario ? "font-medium text-emerald-700" : "text-zinc-600")}>{c.registro_sanitario ?? "—"}</td>
                      <td className={clsx("num", c.fraccion && c.fraccion === sel.unidades_por_empaque ? "font-medium text-emerald-700" : "")}>{c.fraccion ?? "—"}</td>
                      <td className="text-right"><button className="btn-secondary btn-sm" onClick={() => asignar(c.cod_prod)}>Asignar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="px-4 py-2 text-[11.5px] text-zinc-400">En verde: coincide el registro sanitario o la fracción con su producto.</p>
          </>
        )}
      </div>
    </div>
  );
}
