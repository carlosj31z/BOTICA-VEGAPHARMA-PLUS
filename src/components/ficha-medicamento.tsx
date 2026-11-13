"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Modal, Spinner } from "./ui";

export type Ficha = {
  id: number; principio_activo: string; grupo: string | null; para_que_sirve: string; como_actua: string | null;
  dosis_adulto: string | null; dosis_pediatrica: string | null; contraindicaciones: string | null;
  advertencias: string | null; interacciones: string | null; consejo: string | null;
};

const cache = new Map<number, Ficha[]>();

export function useFichas(productoId: number | null | undefined) {
  const [fichas, setFichas] = useState<Ficha[] | null>(productoId ? cache.get(productoId) ?? null : []);
  useEffect(() => {
    if (!productoId) { setFichas([]); return; }
    if (cache.has(productoId)) { setFichas(cache.get(productoId)!); return; }
    setFichas(null);
    let vivo = true;
    supabaseBrowser().rpc("fichas_de_producto", { p_producto_id: productoId }).then(({ data }: any) => {
      cache.set(productoId, data ?? []);
      if (vivo) setFichas(data ?? []);
    });
    return () => { vivo = false; };
  }, [productoId]);
  return fichas;
}

/** Ficha completa de un principio activo. `compacta` muestra solo lo útil en mostrador. */
export function FichaCuerpo({ f, compacta }: { f: Ficha; compacta?: boolean }) {
  const filas: [string, string | null][] = compacta
    ? [["Para qué sirve", f.para_que_sirve], ["Cómo actúa", f.como_actua], ["Dosis adulto", f.dosis_adulto], ["Recomendar", f.consejo], ["No usar si", f.contraindicaciones]]
    : [["Para qué sirve", f.para_que_sirve], ["Cómo actúa", f.como_actua], ["Dosis adulto", f.dosis_adulto], ["Dosis pediátrica", f.dosis_pediatrica],
       ["Contraindicaciones", f.contraindicaciones], ["Advertencias", f.advertencias], ["Interacciones", f.interacciones], ["Qué recomendar", f.consejo]];
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <p className="text-[13px] font-semibold text-zinc-900">{f.principio_activo}</p>
        {f.grupo && <p className="text-[11.5px] text-zinc-500">{f.grupo}</p>}
      </div>
      <dl className={compacta ? "space-y-2 text-[12.5px]" : "grid grid-cols-[130px_1fr] gap-x-4 gap-y-2 text-[13px]"}>
        {filas.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className={compacta ? "" : "contents"}>
            <dt className={compacta ? "text-[11px] font-medium uppercase tracking-wide text-zinc-400" : "text-zinc-500"}>{k}</dt>
            <dd className={k === "Recomendar" || k === "Qué recomendar" ? "text-marca-700" : k.startsWith("Contra") || k === "No usar si" ? "text-rose-700" : "text-zinc-800"}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function FichasProducto({ productoId, compacta, vacio = true }: { productoId: number | null | undefined; compacta?: boolean; vacio?: boolean }) {
  const fichas = useFichas(productoId);
  if (fichas === null) return <div className="py-4"><Spinner /></div>;
  if (!fichas.length) return vacio ? (
    <p className="text-[12.5px] text-zinc-400">Sin ficha para este principio activo. <Link href="/vademecum" className="underline">Agregar en Vademécum</Link></p>
  ) : null;
  return <div className="space-y-4 divide-zinc-100">{fichas.map((f) => <FichaCuerpo key={f.id} f={f} compacta={compacta} />)}</div>;
}

export const AVISO_FICHA = "Información de referencia para orientar al paciente. No reemplaza la indicación médica ni la evaluación del químico farmacéutico.";

export function ModalFicha({ producto, onClose }: { producto: { id: number; nombre: string; concentracion?: string | null } | null; onClose: () => void }) {
  if (!producto) return null;
  return (
    <Modal open onClose={onClose} title={`${producto.nombre} ${producto.concentracion ?? ""}`} size="md">
      <FichasProducto productoId={producto.id} />
      <p className="mt-4 border-t border-zinc-100 pt-2 text-[11px] text-zinc-400">{AVISO_FICHA}</p>
    </Modal>
  );
}
