"use client";
import { useCallback, useEffect, useState } from "react";
import { Wallet, LockOpen, Lock, ArrowDownCircle, ArrowUpCircle, Printer } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useApp } from "@/components/app-context";
import { PageHeader, Field, Modal, Spinner, Stat, Empty } from "@/components/ui";
import { toast } from "@/components/toast";
import { S, fechaHora, METODO_PAGO, errorMsg } from "@/lib/format";

export default function Caja() {
  const { turno, refrescarTurno, puede } = useApp();
  const sb = supabaseBrowser();
  const [cajas, setCajas] = useState<any[]>([]);
  const [cajaId, setCajaId] = useState<number | null>(null);
  const [apertura, setApertura] = useState("");
  const [resumen, setResumen] = useState<any>(null);
  const [movs, setMovs] = useState<any[]>([]);
  const [historial, setHistorial] = useState<any[]>([]);
  const [modalMov, setModalMov] = useState<null | "ingreso" | "egreso">(null);
  const [cerrar, setCerrar] = useState(false);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    const { data: c } = await sb.from("cajas").select("*").eq("activo", true).order("id");
    setCajas(c ?? []); if (c?.[0]) setCajaId((x) => x ?? c[0].id);
    const { data: h } = await sb.from("turnos").select("*, cajas(nombre), perfiles(nombre)").order("abierto_at", { ascending: false }).limit(15);
    setHistorial(h ?? []);
    if (turno) {
      const { data: r } = await sb.rpc("resumen_turno", { p_turno_id: turno.id }); setResumen(r);
      const { data: m } = await sb.from("movimientos_caja").select("*").eq("turno_id", turno.id).order("created_at", { ascending: false }); setMovs(m ?? []);
    } else { setResumen(null); setMovs([]); }
  }, [sb, turno]);
  useEffect(() => { cargar(); }, [cargar]);

  async function abrir() {
    if (!cajaId) return;
    setCargando(true);
    const { error } = await sb.rpc("abrir_turno", { p_caja_id: cajaId, p_monto_apertura: parseFloat(apertura) || 0 });
    setCargando(false);
    if (error) return toast.error(errorMsg(error));
    toast.ok("Turno abierto. Ya puede vender."); setApertura(""); await refrescarTurno();
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader title="Caja y turnos" subtitle="Apertura, movimientos de efectivo y arqueo de cierre" />
      {!turno ? (
        <div className="card mx-auto max-w-lg p-6">
          <div className="flex items-center gap-3"><span className="rounded-xl bg-marca-50 p-2.5 text-marca-600"><LockOpen className="size-5" /></span>
            <div><p className="font-semibold text-slate-900">Abrir turno de caja</p><p className="text-[13px] text-slate-500">Cuente el efectivo inicial (sencillo) antes de empezar.</p></div></div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Field label="Caja"><select className="input" value={cajaId ?? ""} onChange={(e) => setCajaId(Number(e.target.value))}>
              {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Field>
            <Field label="Monto de apertura (S/)"><input className="input text-right tabular-nums" inputMode="decimal" autoFocus value={apertura} onChange={(e) => setApertura(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && abrir()} placeholder="0.00" /></Field>
          </div>
          <button className="btn-primary btn-lg mt-4 w-full" onClick={abrir} disabled={cargando}>{cargando && <Spinner />}Abrir turno</button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-4">
            <Stat label="Ventas del turno" value={S(resumen?.neto)} hint={`${resumen?.ventas ?? 0} comprobantes${resumen?.devoluciones > 0 ? ` · devoluciones ${S(resumen.devoluciones)}` : ""}`} tone="green" icon={<Wallet className="size-4" />} />
            <Stat label="Efectivo esperado en caja" value={S(resumen?.efectivo_esperado)} hint={`Apertura ${S(resumen?.monto_apertura)}`} tone="blue" />
            <Stat label="Ingresos de caja" value={S(resumen?.ingresos)} />
            <Stat label="Egresos de caja" value={S(resumen?.egresos)} />
          </div>
          <div className="mt-4 grid grid-cols-[1fr_1.3fr] gap-4">
            <div className="card">
              <div className="card-h"><p className="card-t">Cobros por medio de pago</p></div>
              <table className="tbl"><tbody>
                {Object.entries(METODO_PAGO).map(([k, l]) => (
                  <tr key={k}><td>{l}</td><td className="num font-medium">{S(resumen?.por_metodo?.[k] ?? 0)}</td></tr>
                ))}
              </tbody></table>
              <div className="flex gap-2 p-3">
                <button className="btn-secondary flex-1" onClick={() => setModalMov("ingreso")}><ArrowDownCircle className="size-4 text-emerald-600" />Ingreso</button>
                <button className="btn-secondary flex-1" onClick={() => setModalMov("egreso")}><ArrowUpCircle className="size-4 text-rose-600" />Egreso / gasto</button>
              </div>
              <div className="border-t border-slate-100 p-3"><button className="btn-danger w-full" onClick={() => setCerrar(true)}><Lock className="size-4" />Cerrar turno y arquear</button></div>
            </div>
            <div className="card">
              <div className="card-h"><p className="card-t">Movimientos de efectivo del turno</p><span className="text-xs text-slate-500">Abierto {fechaHora(turno.abierto_at)}</span></div>
              {movs.length === 0 ? <Empty text="Sin ingresos ni egresos registrados" /> : (
                <table className="tbl"><thead><tr><th>Hora</th><th>Tipo</th><th>Concepto</th><th className="num">Monto</th></tr></thead><tbody>
                  {movs.map((m) => <tr key={m.id}><td>{fechaHora(m.created_at)}</td><td><span className={m.tipo === "ingreso" ? "badge-green" : "badge-red"}>{m.tipo}</span></td><td>{m.concepto}</td><td className="num">{S(m.monto)}</td></tr>)}
                </tbody></table>
              )}
            </div>
          </div>
        </>
      )}

      <div className="card mt-4">
        <div className="card-h"><p className="card-t">Historial de turnos</p></div>
        <table className="tbl">
          <thead><tr><th>Caja</th><th>Usuario</th><th>Apertura</th><th>Cierre</th><th>Estado</th><th className="num">Esperado</th><th className="num">Contado</th><th className="num">Diferencia</th><th /></tr></thead>
          <tbody>
            {historial.map((t) => (
              <tr key={t.id}>
                <td>{t.cajas?.nombre}</td><td>{t.perfiles?.nombre}</td><td>{fechaHora(t.abierto_at)}</td><td>{fechaHora(t.cerrado_at)}</td>
                <td><span className={t.estado === "abierto" ? "badge-green" : "badge-gray"}>{t.estado}</span></td>
                <td className="num">{t.efectivo_esperado != null ? S(t.efectivo_esperado) : "—"}</td>
                <td className="num">{t.efectivo_contado != null ? S(t.efectivo_contado) : "—"}</td>
                <td className={`num font-medium ${Number(t.diferencia) < 0 ? "text-rose-600" : Number(t.diferencia) > 0 ? "text-amber-600" : ""}`}>{t.diferencia != null ? S(t.diferencia) : "—"}</td>
                <td>{t.estado === "cerrado" && <button className="btn-ghost btn-sm" onClick={() => window.open(`/caja/${t.id}/reporte`, "_blank")}><Printer className="size-3.5" /></button>}
                  {t.estado === "abierto" && t.id !== turno?.id && puede("admin") && <CerrarAjeno id={t.id} onDone={cargar} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalMov && <ModalMovimiento tipo={modalMov} onClose={() => setModalMov(null)} onDone={() => { setModalMov(null); cargar(); }} />}
      {cerrar && turno && <ModalCierre turnoId={turno.id} esperado={resumen?.efectivo_esperado ?? 0} onClose={() => setCerrar(false)}
        onDone={async () => { setCerrar(false); const id = turno.id; await refrescarTurno(); window.open(`/caja/${id}/reporte`, "_blank"); }} />}
    </div>
  );
}

function CerrarAjeno({ id, onDone }: { id: number; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="btn-ghost btn-sm text-rose-600" onClick={() => setOpen(true)}>Cerrar</button>
    {open && <ModalCierre turnoId={id} esperado={0} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onDone(); }} />}
  </>;
}

function ModalMovimiento({ tipo, onClose, onDone }: { tipo: "ingreso" | "egreso"; onClose: () => void; onDone: () => void }) {
  const [monto, setMonto] = useState(""); const [concepto, setConcepto] = useState(""); const [env, setEnv] = useState(false);
  async function guardar() {
    if (!(parseFloat(monto) > 0) || !concepto.trim()) return toast.error("Ingrese monto y concepto.");
    setEnv(true);
    const { error } = await supabaseBrowser().rpc("movimiento_caja", { p_tipo: tipo, p_monto: parseFloat(monto), p_concepto: concepto.trim() });
    setEnv(false);
    if (error) return toast.error(errorMsg(error));
    toast.ok("Movimiento registrado"); onDone();
  }
  return (
    <Modal open onClose={onClose} title={tipo === "ingreso" ? "Ingreso de efectivo" : "Egreso / gasto de caja"} size="sm"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={guardar} disabled={env}>Registrar</button></>}>
      <div className="space-y-3">
        <Field label="Monto (S/)"><input className="input text-right" autoFocus inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} /></Field>
        <Field label="Concepto"><input className="input" placeholder={tipo === "egreso" ? "Ej. pago de delivery, útiles de limpieza" : "Ej. reposición de sencillo"} value={concepto} onChange={(e) => setConcepto(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

const DENOM = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1];
function ModalCierre({ turnoId, esperado, onClose, onDone }: { turnoId: number; esperado: number; onClose: () => void; onDone: () => void }) {
  const [cant, setCant] = useState<Record<number, string>>({});
  const [obs, setObs] = useState(""); const [env, setEnv] = useState(false);
  const contado = Math.round(DENOM.reduce((a, d) => a + d * (parseInt(cant[d] || "0") || 0), 0) * 100) / 100;
  const dif = Math.round((contado - esperado) * 100) / 100;
  async function cerrar() {
    setEnv(true);
    const { error } = await supabaseBrowser().rpc("cerrar_turno", { p_turno_id: turnoId, p_efectivo_contado: contado, p_observacion: obs || null });
    setEnv(false);
    if (error) return toast.error(errorMsg(error));
    toast.ok("Turno cerrado"); onDone();
  }
  return (
    <Modal open onClose={onClose} title="Arqueo y cierre de turno" size="md"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-danger" onClick={cerrar} disabled={env}>{env && <Spinner />}Cerrar turno</button></>}>
      <p className="mb-3 text-[13px] text-slate-500">Cuente el efectivo por denominación. El sistema calcula el total y la diferencia.</p>
      <div className="grid grid-cols-4 gap-2">
        {DENOM.map((d) => (
          <label key={d} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5">
            <span className="w-14 text-xs font-medium text-slate-600">{d >= 10 ? `S/ ${d}` : `S/ ${d.toFixed(2)}`}</span>
            <input className="input h-7 px-2 text-right tabular-nums" inputMode="numeric" value={cant[d] ?? ""} onChange={(e) => setCant({ ...cant, [d]: e.target.value.replace(/\D/g, "") })} />
          </label>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg bg-slate-50 p-3 text-center">
        <div><p className="text-xs text-slate-500">Esperado</p><p className="text-lg font-semibold tabular-nums">{S(esperado)}</p></div>
        <div><p className="text-xs text-slate-500">Contado</p><p className="text-lg font-semibold tabular-nums">{S(contado)}</p></div>
        <div><p className="text-xs text-slate-500">Diferencia</p><p className={`text-lg font-semibold tabular-nums ${dif < 0 ? "text-rose-600" : dif > 0 ? "text-amber-600" : "text-emerald-600"}`}>{S(dif)}</p></div>
      </div>
      <Field label="Observación" className="mt-3"><textarea className="input" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
    </Modal>
  );
}
