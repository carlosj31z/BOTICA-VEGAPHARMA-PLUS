"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowLeft, MonitorSmartphone, Search } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { VisorCamara, canalEscaner, pitido } from "@/components/escaner";
import { FichasProducto } from "@/components/ficha-medicamento";
import { S, N, fecha } from "@/lib/format";

/**
 * Celular como lector de códigos. Abra /escaner en el teléfono con el mismo usuario de la caja:
 * - "Enviar a caja": cada lectura aparece en el carrito del punto de venta de la computadora.
 * - "Consultar": muestra precio, stock, vencimiento y orientación del producto (útil en anaquel).
 */
export default function Escaner() {
  const sb = useRef(supabaseBrowser()).current;
  const canal = useRef<ReturnType<typeof sb.channel> | null>(null);
  const [modo, setModo] = useState<"caja" | "consulta">("caja");
  const [cajas, setCajas] = useState(0);
  const [lecturas, setLecturas] = useState<{ codigo: string; nombre?: string; precio?: number; ok: boolean; t: number }[]>([]);
  const [producto, setProducto] = useState<any>(null);
  const [manual, setManual] = useState("");
  const modoRef = useRef(modo); modoRef.current = modo;

  useEffect(() => {
    let ch: any;
    sb.auth.getUser().then(({ data }: any) => {
      if (!data.user) return;
      ch = sb.channel(canalEscaner(data.user.id), { config: { presence: { key: "lector" } } });
      ch.on("presence", { event: "sync" }, () => {
        const st = ch.presenceState() as Record<string, any[]>;
        setCajas(Object.values(st).flat().filter((p: any) => p.rol === "pos").length);
      }).subscribe((s: string) => { if (s === "SUBSCRIBED") ch.track({ rol: "lector" }); });
      canal.current = ch;
    });
    return () => { if (ch) sb.removeChannel(ch); };
  }, [sb]);

  async function leido(codigo: string) {
    const { data } = await sb.from("v_productos").select("*").eq("activo", true).or(`codigo_barras.eq.${codigo},codigo.eq.${codigo}`).limit(1);
    const p = data?.[0];
    if (!p) pitido(false);
    if (modoRef.current === "consulta") { setProducto(p ?? { noEncontrado: codigo }); }
    else if (p) canal.current?.send({ type: "broadcast", event: "codigo", payload: { codigo } });
    setLecturas((l) => [{ codigo, nombre: p ? `${p.nombre} ${p.concentracion ?? ""}` : undefined, precio: p?.precio_unidad, ok: !!p, t: Date.now() }, ...l].slice(0, 15));
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-white">
      <header className="flex h-12 items-center gap-2 border-b border-zinc-100 px-3">
        <Link href="/" className="rounded p-1.5 text-zinc-500"><ArrowLeft className="size-4" /></Link>
        <p className="flex-1 text-[14px] font-semibold text-zinc-900">Lector de códigos</p>
        <span className={clsx("flex items-center gap-1.5 text-[11.5px]", cajas ? "text-emerald-700" : "text-zinc-400")}>
          <MonitorSmartphone className="size-3.5" />{cajas ? "Caja conectada" : "Caja no abierta"}
        </span>
      </header>
      <div className="p-3">
        <div className="seg mb-3 grid w-full grid-cols-2">
          <button data-on={modo === "caja"} onClick={() => setModo("caja")}>Enviar a caja</button>
          <button data-on={modo === "consulta"} onClick={() => setModo("consulta")}>Consultar precio</button>
        </div>
        <VisorCamara onCodigo={leido} className="aspect-[4/3]" />
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { leido(manual.trim()); setManual(""); } }}>
          <input className="input" inputMode="numeric" placeholder="Escribir código" value={manual} onChange={(e) => setManual(e.target.value)} />
          <button className="btn-secondary"><Search className="size-4" /></button>
        </form>
        {modo === "caja" && !cajas && <p className="mt-2 text-[12px] text-amber-700">Abra el Punto de venta en la computadora con este mismo usuario.</p>}
      </div>

      {modo === "consulta" && producto && (
        <div className="mx-3 mb-3 rounded-lg border border-zinc-200 p-3">
          {producto.noEncontrado ? <p className="text-[13px] text-rose-600">Código {producto.noEncontrado} no registrado.</p> : (
            <>
              <p className="text-[14px] font-semibold text-zinc-900">{producto.nombre} {producto.concentracion}</p>
              <p className="text-[12px] text-zinc-500">{[producto.principio_activo, producto.laboratorio].filter(Boolean).join(" · ")}</p>
              <div className="my-2 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-zinc-50 py-1.5"><p className="text-[11px] text-zinc-500">Unidad</p><p className="font-semibold tabular-nums">{S(producto.precio_unidad)}</p></div>
                <div className="rounded-md bg-zinc-50 py-1.5"><p className="text-[11px] text-zinc-500">{producto.unidades_por_empaque > 1 ? `Caja x${producto.unidades_por_empaque}` : "Caja"}</p><p className="font-semibold tabular-nums">{producto.unidades_por_empaque > 1 ? S(producto.precio_empaque) : "—"}</p></div>
                <div className="rounded-md bg-zinc-50 py-1.5"><p className="text-[11px] text-zinc-500">Stock</p><p className="font-semibold tabular-nums">{N(producto.stock_vendible)}</p></div>
              </div>
              {producto.proximo_vencimiento && <p className="mb-2 text-[12px] text-zinc-500">Próximo vencimiento: {fecha(producto.proximo_vencimiento)}</p>}
              <FichasProducto productoId={producto.id} compacta vacio={false} />
            </>
          )}
        </div>
      )}

      <div className="border-t border-zinc-100">
        {lecturas.map((l) => (
          <div key={l.t} className="flex items-center gap-2 border-b border-zinc-50 px-3 py-2 text-[12.5px]">
            <span className={clsx("size-1.5 rounded-full", l.ok ? "bg-emerald-500" : "bg-rose-500")} />
            <span className="flex-1 truncate">{l.nombre ?? <span className="text-rose-600">No registrado · {l.codigo}</span>}</span>
            {l.precio != null && <span className="tabular-nums text-zinc-500">{S(l.precio)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
