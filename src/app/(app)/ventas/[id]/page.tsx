"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Printer, Send, Undo2, Ban, FileDown, Stethoscope } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useApp } from "@/components/app-context";
import { PageHeader, Modal, Field, Spinner } from "@/components/ui";
import { EstadoSunat } from "@/components/estado-sunat";
import { toast } from "@/components/toast";
import { S, fechaHora, fecha, comprobante, TIPO_COMPROBANTE, METODO_PAGO, TIPO_DOC, errorMsg } from "@/lib/format";

const MOTIVOS_NC = [["01", "Anulación de la operación"], ["02", "Anulación por error en el RUC"], ["06", "Devolución total"], ["07", "Devolución por ítem"], ["09", "Disminución en el valor"]];

export default function VentaDetalle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { puede } = useApp();
  const sb = supabaseBrowser();
  const [v, setV] = useState<any>(null);
  const [nc, setNc] = useState(false);
  const [anular, setAnular] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    const { data } = await sb.from("ventas").select("*, clientes(*), venta_items(*, venta_item_lotes(cantidad, lotes(numero_lote, fecha_vencimiento))), pagos(*), recetas(*), perfiles(nombre), ref:venta_referencia_id(id,serie,numero), notas:ventas!venta_referencia_id(id,serie,numero,anulada)").eq("id", id).single();
    setV(data);
  }, [sb, id]);
  useEffect(() => { cargar(); }, [cargar]);

  async function enviarSunat() {
    setEnviando(true);
    const r = await fetch("/api/sunat/enviar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ venta_id: Number(id) }) });
    const j = await r.json().catch(() => ({}));
    setEnviando(false);
    if (!r.ok) toast.error(j.error ?? "No se pudo enviar"); else toast.ok(j.mensaje ?? "Enviado");
    cargar();
  }

  if (!v) return <div className="grid h-64 place-items-center"><Spinner /></div>;
  const electronico = v.tipo !== "NV";
  const tieneNC = (v.notas ?? []).some((n: any) => !n.anulada);

  return (
    <div className="mx-auto max-w-[1100px]">
      <Link href="/ventas" className="mb-2 inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-800"><ArrowLeft className="size-3.5" />Historial</Link>
      <PageHeader title={`${TIPO_COMPROBANTE[v.tipo]} ${comprobante(v.serie, v.numero)}`} subtitle={`${fechaHora(v.fecha)} · atendió ${v.perfiles?.nombre ?? "—"}`}
        actions={<>
          {electronico && !["aceptado", "anulado"].includes(v.sunat_estado) && <button className="btn-secondary" onClick={enviarSunat} disabled={enviando}>{enviando ? <Spinner /> : <Send className="size-4" />}Enviar a SUNAT</button>}
          {v.sunat_pdf_url && <a className="btn-secondary" href={v.sunat_pdf_url} target="_blank"><FileDown className="size-4" />PDF</a>}
          {["01", "03"].includes(v.tipo) && !tieneNC && puede("admin", "quimico") && <button className="btn-secondary" onClick={() => setNc(true)}><Undo2 className="size-4" />Nota de crédito</button>}
          {v.tipo === "NV" && !v.anulada && puede("admin", "quimico") && <button className="btn-secondary text-rose-600" onClick={() => setAnular(true)}><Ban className="size-4" />Anular</button>}
          <button className="btn-primary" onClick={() => window.open(`/ventas/${v.id}/ticket`, "ticket", "width=420,height=700")}><Printer className="size-4" />Imprimir</button>
        </>} />

      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="label">Cliente</p>
          <p className="font-medium text-slate-900">{v.clientes.nombre}</p>
          <p className="text-[13px] text-slate-500">{TIPO_DOC[v.clientes.tipo_documento]} {v.clientes.tipo_documento !== "0" && v.clientes.numero_documento}</p>
          {v.clientes.direccion && <p className="text-[13px] text-slate-500">{v.clientes.direccion}</p>}
        </div>
        <div className="card p-4">
          <p className="label">Estado electrónico</p>
          <div className="flex items-center gap-2"><EstadoSunat e={v.sunat_estado} />{v.anulada && <span className="badge-red">Anulada</span>}</div>
          {v.sunat_mensaje && <p className="mt-1.5 text-xs text-slate-500">{v.sunat_mensaje}</p>}
          {v.ref && <p className="mt-1.5 text-xs">Modifica a <Link className="text-marca-700 hover:underline" href={`/ventas/${v.ref.id}`}>{comprobante(v.ref.serie, v.ref.numero)}</Link> · {v.motivo_nota}</p>}
          {(v.notas ?? []).map((n: any) => <p key={n.id} className="mt-1.5 text-xs">Nota de crédito <Link className="text-marca-700 hover:underline" href={`/ventas/${n.id}`}>{comprobante(n.serie, n.numero)}</Link></p>)}
        </div>
        <div className="card p-4">
          <p className="label">Pagos</p>
          {(v.pagos ?? []).map((p: any) => (
            <div key={p.id} className="flex justify-between text-[13px]">
              <span>{METODO_PAGO[p.metodo]}{p.pos_proveedor && <span className="text-slate-500"> · {p.pos_proveedor}</span>}{p.numero_operacion && <span className="text-slate-500"> #{p.numero_operacion}</span>}</span>
              <span className="tabular-nums">{S(p.monto)}</span>
            </div>
          ))}
        </div>
      </div>

      {v.recetas && (
        <div className="card mt-4 flex items-start gap-3 border-sky-200 p-4 text-[13px]">
          <Stethoscope className="mt-0.5 size-4 text-sky-600" />
          <div className="grid flex-1 grid-cols-4 gap-2">
            <div><p className="label">Paciente</p>{v.recetas.paciente_nombre} {v.recetas.paciente_documento}</div>
            <div><p className="label">Prescriptor</p>{v.recetas.medico_nombre} · CMP {v.recetas.medico_cmp}</div>
            <div><p className="label">Receta</p>{v.recetas.numero || "s/n"} · {fecha(v.recetas.fecha_receta)}</div>
            <div><p className="label">Condición</p>{v.recetas.retenida ? <span className="badge-violet">Retenida</span> : "Devuelta al paciente"}</div>
          </div>
        </div>
      )}

      <div className="card mt-4">
        <table className="tbl">
          <thead><tr><th>Descripción</th><th>Lote(s)</th><th className="num">Cant.</th><th className="num">P. unit.</th><th className="num">Desc.</th><th className="num">Valor venta</th><th className="num">IGV</th><th className="num">Importe</th></tr></thead>
          <tbody>
            {v.venta_items.map((i: any) => (
              <tr key={i.id}>
                <td className="font-medium">{i.descripcion}</td>
                <td className="text-xs text-slate-500">{(i.venta_item_lotes ?? []).map((l: any) => `${l.lotes.numero_lote} (${l.cantidad} u., v. ${fecha(l.lotes.fecha_vencimiento)})`).join(", ")}</td>
                <td className="num">{Number(i.cantidad)} {i.unidad === "BX" ? "cj" : "u"}</td>
                <td className="num">{S(i.precio_unitario)}</td>
                <td className="num">{Number(i.descuento) ? S(i.descuento) : "—"}</td>
                <td className="num">{S(i.valor_venta)}</td>
                <td className="num">{S(i.igv)}</td>
                <td className="num font-medium">{S(i.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={6} /><td className="num text-slate-500">Op. gravada</td><td className="num">{S(v.op_gravada)}</td></tr>
            {Number(v.op_exonerada) > 0 && <tr><td colSpan={6} /><td className="num text-slate-500">Exonerada</td><td className="num">{S(v.op_exonerada)}</td></tr>}
            <tr><td colSpan={6} /><td className="num text-slate-500">IGV</td><td className="num">{S(v.igv)}</td></tr>
            <tr><td colSpan={6} /><td className="num font-semibold">Total</td><td className="num text-base font-bold">{S(v.total)}</td></tr>
          </tfoot>
        </table>
      </div>

      {nc && <ModalNC venta={v} onClose={() => setNc(false)} onDone={(nid) => { setNc(false); location.href = `/ventas/${nid}`; }} />}
      {anular && <ModalAnular id={v.id} onClose={() => setAnular(false)} onDone={() => { setAnular(false); cargar(); }} />}
    </div>
  );
}

function ModalNC({ venta, onClose, onDone }: { venta: any; onClose: () => void; onDone: (id: number) => void }) {
  const [tipo, setTipo] = useState("06"); const [motivo, setMotivo] = useState(""); const [metodo, setMetodo] = useState(""); const [env, setEnv] = useState(false);
  async function emitir() {
    if (!motivo.trim()) return toast.error("Indique el motivo.");
    setEnv(true);
    const { data, error } = await supabaseBrowser().rpc("emitir_nota_credito", { p_venta_id: venta.id, p_tipo_nota: tipo, p_motivo: motivo.trim(), p_metodo_devolucion: metodo || null });
    setEnv(false);
    if (error) return toast.error(errorMsg(error));
    toast.ok(`Nota de crédito ${data.comprobante} emitida. El stock volvió a sus lotes.`);
    fetch("/api/sunat/enviar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ venta_id: data.venta_id }) }).catch(() => {});
    onDone(data.venta_id);
  }
  return (
    <Modal open onClose={onClose} title={`Nota de crédito sobre ${comprobante(venta.serie, venta.numero)}`}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={emitir} disabled={env}>{env && <Spinner />}Emitir por {S(venta.total)}</button></>}>
      <div className="space-y-3">
        <p className="rounded-lg bg-amber-50 p-3 text-[13px] text-amber-800">Se devolverá el total del comprobante y las unidades regresarán a los mismos lotes. El dinero devuelto se descuenta de su turno.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo (catálogo 09 SUNAT)"><select className="input" value={tipo} onChange={(e) => setTipo(e.target.value)}>{MOTIVOS_NC.map(([k, l]) => <option key={k} value={k}>{k} · {l}</option>)}</select></Field>
          <Field label="Devolver dinero por"><select className="input" value={metodo} onChange={(e) => setMetodo(e.target.value)}><option value="">Igual que el pago original</option>{Object.entries(METODO_PAGO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        </div>
        <Field label="Motivo / sustento"><textarea className="input" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ModalAnular({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: () => void }) {
  const [motivo, setMotivo] = useState("");
  async function ok() {
    if (!motivo.trim()) return toast.error("Indique el motivo.");
    const { error } = await supabaseBrowser().rpc("anular_nota_venta", { p_venta_id: id, p_motivo: motivo.trim() });
    if (error) return toast.error(errorMsg(error));
    toast.ok("Nota de venta anulada y stock devuelto"); onDone();
  }
  return (
    <Modal open onClose={onClose} title="Anular nota de venta" size="sm" footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-danger" onClick={ok}>Anular</button></>}>
      <Field label="Motivo"><textarea className="input" rows={2} autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>
    </Modal>
  );
}
