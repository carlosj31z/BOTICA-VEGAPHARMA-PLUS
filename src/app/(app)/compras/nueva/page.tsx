"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Search, Trash2, Save } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PageHeader, Field, Spinner, Empty } from "@/components/ui";
import { toast } from "@/components/toast";
import { S, errorMsg, hoyLima } from "@/lib/format";

type Item = { key: string; producto: any; numero_lote: string; fecha_vencimiento: string; presentacion: "unidad" | "empaque"; cantidad: string; costo: string; nuevo_precio_unidad?: string; nuevo_precio_empaque?: string };

export default function NuevaCompra() {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [proveedores, setProveedores] = useState<any[]>([]);
  const [cab, setCab] = useState({ proveedor_id: "", tipo_documento: "01", serie_numero: "", fecha: hoyLima(), observacion: "" });
  const [incluyeIgv, setIncluyeIgv] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [ops, setOps] = useState<any[]>([]);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { sb.from("proveedores").select("id,razon_social,ruc").eq("activo", true).order("razon_social").then(({ data }: any) => setProveedores(data ?? [])); }, [sb]);
  useEffect(() => {
    const t0 = q.trim(); if (t0.length < 2) { setOps([]); return; }
    const term = t0.replace(/[,()%]/g, " ");
    const t = setTimeout(() => sb.from("productos").select("*").eq("activo", true).or(`nombre.ilike.%${term}%,codigo_barras.eq.${term},codigo.eq.${term}`).limit(15).then(({ data }: any) => setOps(data ?? [])), 200);
    return () => clearTimeout(t);
  }, [q, sb]);

  const agregar = (p: any) => {
    setItems((x) => [...x, { key: `${p.id}-${Date.now()}`, producto: p, numero_lote: "", fecha_vencimiento: "", presentacion: p.unidades_por_empaque > 1 ? "empaque" : "unidad", cantidad: "", costo: "" }]);
    setQ(""); setOps([]);
  };
  const upd = (k: string, patch: Partial<Item>) => setItems((x) => x.map((i) => (i.key === k ? { ...i, ...patch } : i)));
  const costoSinIgv = (i: Item) => { const c = parseFloat(i.costo) || 0; return incluyeIgv ? c / 1.18 : c; };
  const subtotal = useMemo(() => items.reduce((a, i) => a + (parseFloat(i.cantidad) || 0) * costoSinIgv(i), 0), [items, incluyeIgv]); // eslint-disable-line

  async function guardar() {
    if (!cab.proveedor_id || !cab.serie_numero.trim()) return toast.error("Seleccione proveedor e ingrese el N° de documento.");
    if (!items.length) return toast.error("Agregue productos.");
    for (const i of items) {
      if (!i.numero_lote.trim() || !i.fecha_vencimiento || !(parseFloat(i.cantidad) > 0) || !(parseFloat(i.costo) >= 0)) return toast.error(`Complete lote, vencimiento, cantidad y costo de ${i.producto.nombre}.`);
      if (i.fecha_vencimiento <= hoyLima()) return toast.error(`El lote de ${i.producto.nombre} ya está vencido.`);
    }
    setGuardando(true);
    const { data, error } = await sb.rpc("registrar_compra", { p: {
      ...cab, proveedor_id: Number(cab.proveedor_id),
      items: items.map((i) => ({ producto_id: i.producto.id, numero_lote: i.numero_lote, fecha_vencimiento: i.fecha_vencimiento, presentacion: i.presentacion,
        cantidad: parseFloat(i.cantidad), costo: Math.round(costoSinIgv(i) * 10000) / 10000 })),
    } });
    if (error) { setGuardando(false); return toast.error(error.code === "23505" ? "Ese documento ya fue registrado para este proveedor." : errorMsg(error)); }
    // Actualización opcional de precios de venta
    for (const i of items) {
      const patch: any = {};
      if (i.nuevo_precio_unidad && parseFloat(i.nuevo_precio_unidad) > 0) patch.precio_unidad = parseFloat(i.nuevo_precio_unidad);
      if (i.nuevo_precio_empaque && parseFloat(i.nuevo_precio_empaque) > 0) patch.precio_empaque = parseFloat(i.nuevo_precio_empaque);
      if (Object.keys(patch).length) await sb.from("productos").update(patch).eq("id", i.producto.id);
    }
    toast.ok(`Compra #${data} registrada. Stock actualizado.`);
    router.push("/compras");
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <Link href="/compras" className="mb-2 inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-800"><ArrowLeft className="size-3.5" />Compras</Link>
      <PageHeader title="Registrar compra" subtitle="Cada ítem crea o incrementa su lote y queda en el kardex"
        actions={<button className="btn-primary" onClick={guardar} disabled={guardando}>{guardando ? <Spinner /> : <Save className="size-4" />}Guardar compra</button>} />
      <div className="card grid grid-cols-6 gap-3 p-4">
        <Field label="Proveedor *" className="col-span-2"><select className="input" value={cab.proveedor_id} onChange={(e) => setCab({ ...cab, proveedor_id: e.target.value })}>
          <option value="">Seleccione…</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.razon_social} · {p.ruc}</option>)}</select>
          {proveedores.length === 0 && <Link href="/proveedores" className="mt-1 block text-xs text-marca-700 hover:underline">Registrar un proveedor primero</Link>}</Field>
        <Field label="Documento"><select className="input" value={cab.tipo_documento} onChange={(e) => setCab({ ...cab, tipo_documento: e.target.value })}>
          <option value="01">Factura</option><option value="03">Boleta</option><option value="09">Guía de remisión</option></select></Field>
        <Field label="Serie-número *"><input className="input" placeholder="F001-000123" value={cab.serie_numero} onChange={(e) => setCab({ ...cab, serie_numero: e.target.value.toUpperCase() })} /></Field>
        <Field label="Fecha"><input type="date" className="input" value={cab.fecha} onChange={(e) => setCab({ ...cab, fecha: e.target.value })} /></Field>
        <label className="mt-6 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={incluyeIgv} onChange={(e) => setIncluyeIgv(e.target.checked)} />Costos incluyen IGV</label>
      </div>

      <div className="card mt-4">
        <div className="relative border-b border-slate-100 p-3">
          <div className="relative w-[30rem]"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-8" placeholder="Agregar producto por nombre o código de barras…" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ops[0] && agregar(ops[0])} /></div>
          {ops.length > 0 && <div className="absolute left-3 top-full z-20 mt-1 w-[30rem] rounded-lg border border-slate-200 bg-white shadow-lg">
            {ops.map((o) => <button key={o.id} onClick={() => agregar(o)} className="block w-full px-3 py-2 text-left text-[13px] hover:bg-slate-50">{o.nombre} {o.concentracion} <span className="text-slate-400">{o.presentacion}</span></button>)}</div>}
        </div>
        {items.length === 0 ? <Empty text="Agregue los productos de la factura" /> : (
          <table className="tbl">
            <thead><tr><th>Producto</th><th className="w-32">Lote *</th><th className="w-40">Vencimiento *</th><th className="w-48">Cantidad *</th><th className="w-32 num">Costo {incluyeIgv ? "c/IGV" : "s/IGV"} *</th>
              <th className="w-28 num">Subtotal</th><th className="w-48">Nuevo precio venta (opc.)</th><th className="w-8" /></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.key}>
                  <td><p className="font-medium">{i.producto.nombre} {i.producto.concentracion}</p><p className="text-xs text-slate-500">Actual: {S(i.producto.precio_unidad)} u. · {S(i.producto.precio_empaque)} cj.</p></td>
                  <td><input className="input h-8" value={i.numero_lote} onChange={(e) => upd(i.key, { numero_lote: e.target.value.toUpperCase() })} /></td>
                  <td><input type="date" className="input h-8" value={i.fecha_vencimiento} onChange={(e) => upd(i.key, { fecha_vencimiento: e.target.value })} /></td>
                  <td><div className="flex gap-1"><input className="input h-8 w-20 text-right" inputMode="numeric" value={i.cantidad} onChange={(e) => upd(i.key, { cantidad: e.target.value.replace(/[^\d]/g, "") })} />
                    {i.producto.unidades_por_empaque > 1 && <select className="input h-8" value={i.presentacion} onChange={(e) => upd(i.key, { presentacion: e.target.value as any })}>
                      <option value="empaque">Cajas x{i.producto.unidades_por_empaque}</option><option value="unidad">Unidades</option></select>}</div></td>
                  <td><input className="input h-8 text-right" inputMode="decimal" placeholder={`por ${i.presentacion === "empaque" ? "caja" : "unidad"}`} value={i.costo} onChange={(e) => upd(i.key, { costo: e.target.value })} /></td>
                  <td className="num">{S((parseFloat(i.cantidad) || 0) * costoSinIgv(i))}</td>
                  <td><div className="flex gap-1"><input className="input h-8 text-right" placeholder="Unidad" value={i.nuevo_precio_unidad ?? ""} onChange={(e) => upd(i.key, { nuevo_precio_unidad: e.target.value })} />
                    {i.producto.unidades_por_empaque > 1 && <input className="input h-8 text-right" placeholder="Caja" value={i.nuevo_precio_empaque ?? ""} onChange={(e) => upd(i.key, { nuevo_precio_empaque: e.target.value })} />}</div></td>
                  <td><button onClick={() => setItems((x) => x.filter((y) => y.key !== i.key))} className="text-slate-400 hover:text-rose-600"><Trash2 className="size-4" /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={5} className="num text-slate-500">Subtotal</td><td className="num">{S(subtotal)}</td><td colSpan={2} /></tr>
              <tr><td colSpan={5} className="num text-slate-500">IGV 18%</td><td className="num">{S(subtotal * 0.18)}</td><td colSpan={2} /></tr>
              <tr><td colSpan={5} className="num font-semibold">Total</td><td className="num font-bold">{S(subtotal * 1.18)}</td><td colSpan={2} /></tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
