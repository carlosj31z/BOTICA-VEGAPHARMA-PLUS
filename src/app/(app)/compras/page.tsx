"use client";
import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, ChevronDown, ChevronRight } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PageHeader, Empty } from "@/components/ui";
import { S, N, fecha } from "@/lib/format";

export default function Compras() {
  const sb = supabaseBrowser();
  const [rows, setRows] = useState<any[]>([]);
  const [abierta, setAbierta] = useState<number | null>(null);
  useEffect(() => {
    sb.from("compras").select("*, proveedores(razon_social,ruc), perfiles(nombre), compra_items(*, productos(nombre,concentracion))")
      .order("fecha", { ascending: false }).order("id", { ascending: false }).limit(300).then(({ data }: any) => setRows(data ?? []));
  }, [sb]);
  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader title="Compras" subtitle="Ingresos de mercadería por factura de proveedor"
        actions={<Link href="/compras/nueva" className="btn-primary"><Plus className="size-4" />Registrar compra</Link>} />
      <div className="card">
        {rows.length === 0 ? <Empty text="Aún no hay compras registradas" /> : (
          <table className="tbl">
            <thead><tr><th className="w-8" /><th>Fecha</th><th>Proveedor</th><th>Documento</th><th className="num">Ítems</th><th className="num">Subtotal</th><th className="num">IGV</th><th className="num">Total</th><th>Registró</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <Fragment key={c.id}>
                  <tr className="cursor-pointer" onClick={() => setAbierta(abierta === c.id ? null : c.id)}>
                    <td>{abierta === c.id ? <ChevronDown className="size-4 text-slate-400" /> : <ChevronRight className="size-4 text-slate-400" />}</td>
                    <td>{fecha(c.fecha)}</td>
                    <td><p className="font-medium">{c.proveedores?.razon_social}</p><p className="text-xs text-slate-500">RUC {c.proveedores?.ruc}</p></td>
                    <td>{c.serie_numero}</td>
                    <td className="num">{c.compra_items.length}</td>
                    <td className="num">{S(c.subtotal)}</td><td className="num">{S(c.igv)}</td><td className="num font-medium">{S(c.total)}</td>
                    <td className="text-slate-500">{c.perfiles?.nombre}</td>
                  </tr>
                  {abierta === c.id && (
                    <tr><td colSpan={9} className="bg-slate-50/60 p-0">
                      <table className="tbl text-[12.5px]"><thead><tr><th>Producto</th><th>Lote</th><th>Vencimiento</th><th className="num">Unidades</th><th className="num">Costo u.</th><th className="num">Total</th></tr></thead>
                        <tbody>{c.compra_items.map((i: any) => (
                          <tr key={i.id}><td>{i.productos?.nombre} {i.productos?.concentracion}</td><td className="font-mono">{i.numero_lote}</td><td>{fecha(i.fecha_vencimiento)}</td>
                            <td className="num">{N(i.cantidad)}</td><td className="num">{S(i.costo_unitario)}</td><td className="num">{S(i.total)}</td></tr>
                        ))}</tbody></table>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
