"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Modal, Field, Spinner } from "./ui";
import { toast } from "./toast";
import { errorMsg } from "@/lib/format";
import type { Producto } from "@/lib/types";

/** Ingreso de stock sin factura de compra: inventario inicial o ajuste de entrada. */
export function ModalIngresoStock({ producto, onClose, onDone }: { producto: Producto; onClose: () => void; onDone: () => void }) {
  const [lote, setLote] = useState(""); const [venc, setVenc] = useState(""); const [cant, setCant] = useState("");
  const [pres, setPres] = useState<"unidad" | "empaque">(producto.unidades_por_empaque > 1 ? "empaque" : "unidad");
  const [costo, setCosto] = useState(""); const [tipo, setTipo] = useState("inventario_inicial"); const [nota, setNota] = useState(""); const [env, setEnv] = useState(false);
  const factor = pres === "empaque" ? producto.unidades_por_empaque : 1;
  async function guardar() {
    const unidades = (parseInt(cant) || 0) * factor;
    if (!lote.trim() || !venc || unidades <= 0) return toast.error("Complete lote, vencimiento y cantidad.");
    setEnv(true);
    const { error } = await supabaseBrowser().rpc("ingresar_stock", {
      p_producto_id: producto.id, p_numero_lote: lote, p_fecha_vencimiento: venc, p_cantidad: unidades,
      p_costo_unitario: costo ? parseFloat(costo) / factor : 0, p_tipo: tipo, p_nota: nota || null,
    });
    setEnv(false);
    if (error) return toast.error(errorMsg(error));
    toast.ok(`${unidades} unidades ingresadas al lote ${lote.toUpperCase()}`); onDone();
  }
  return (
    <Modal open onClose={onClose} title={`Ingresar stock · ${producto.nombre}`}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={guardar} disabled={env}>{env && <Spinner />}Ingresar</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Motivo"><select className="input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="inventario_inicial">Inventario inicial</option><option value="ajuste_entrada">Ajuste de entrada (sobrante)</option></select></Field>
        <Field label="N° de lote"><input className="input" autoFocus value={lote} onChange={(e) => setLote(e.target.value.toUpperCase())} /></Field>
        <Field label="Fecha de vencimiento"><input type="date" className="input" value={venc} onChange={(e) => setVenc(e.target.value)} /></Field>
        <Field label="Cantidad"><div className="flex gap-1">
          <input className="input text-right" inputMode="numeric" value={cant} onChange={(e) => setCant(e.target.value.replace(/\D/g, ""))} />
          {producto.unidades_por_empaque > 1 && <select className="input w-32" value={pres} onChange={(e) => setPres(e.target.value as any)}>
            <option value="empaque">Cajas x{producto.unidades_por_empaque}</option><option value="unidad">Unidades</option></select>}
        </div></Field>
        <Field label={`Costo por ${pres === "empaque" ? "caja" : "unidad"} sin IGV (S/)`}><input className="input text-right" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} /></Field>
        <Field label="Nota"><input className="input" value={nota} onChange={(e) => setNota(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
