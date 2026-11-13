"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ExternalLink, Lock, LockOpen, Plus, RefreshCw, Check } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useApp } from "@/components/app-context";
import { Empty, Field, Modal, Spinner } from "@/components/ui";
import { toast } from "@/components/toast";
import { N, fecha, errorMsg, hoyLima } from "@/lib/format";

type Alerta = { id: number; numero: string | null; fecha: string | null; titulo: string; descripcion: string | null; url: string | null; fuente: string; revisada: boolean; nota_revision: string | null };
type Coinc = { alerta_id: number; producto_id: number; producto: string; lote_id: number | null; numero_lote: string | null; stock: number | null; bloqueado: boolean | null; coincide_por: string };

const COINCIDE: Record<string, string> = { lote: "Lote", registro_sanitario: "Reg. sanitario", nombre: "Nombre" };

/** Alertas y modificaciones publicadas por DIGEMID, cruzadas contra productos y lotes del inventario. */
export function AlertasSanitarias() {
  const { puede } = useApp();
  const sb = supabaseBrowser();
  const editor = puede("admin", "quimico");
  const [alertas, setAlertas] = useState<Alerta[] | null>(null);
  const [coinc, setCoinc] = useState<Coinc[]>([]);
  const [ver, setVer] = useState<"pendientes" | "afectan" | "todas">("pendientes");
  const [sel, setSel] = useState<number | null>(null);
  const [sinc, setSinc] = useState(false);
  const [nueva, setNueva] = useState(false);

  const cargar = useCallback(async () => {
    const [a, c] = await Promise.all([
      sb.from("alertas_sanitarias").select("*").order("fecha", { ascending: false, nullsFirst: false }).order("id", { ascending: false }).limit(300),
      sb.from("v_alertas_coincidencias").select("*"),
    ]);
    setAlertas(a.data ?? []); setCoinc(c.data ?? []);
  }, [sb]);
  useEffect(() => { cargar(); }, [cargar]);

  const porAlerta = useMemo(() => {
    const m = new Map<number, Coinc[]>();
    coinc.forEach((c) => m.set(c.alerta_id, [...(m.get(c.alerta_id) ?? []), c]));
    return m;
  }, [coinc]);

  const lista = (alertas ?? []).filter((a) => ver === "todas" || (ver === "pendientes" ? !a.revisada : porAlerta.has(a.id)));
  const actual = alertas?.find((a) => a.id === (sel ?? lista[0]?.id));

  async function sincronizar() {
    setSinc(true);
    const r = await fetch("/api/digemid/alertas", { method: "POST" }).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    setSinc(false);
    if (r?.ok) { toast.ok(d.mensaje); cargar(); } else toast.error(d?.error ?? "No se pudo sincronizar con DIGEMID.");
  }

  async function revisar(a: Alerta, revisada: boolean) {
    const nota = revisada ? window.prompt("Nota de revisión (opcional): qué se verificó o hizo", a.nota_revision ?? "") : null;
    if (revisada && nota === null) return;
    const { error } = await sb.from("alertas_sanitarias").update({
      revisada, nota_revision: nota || null, revisada_at: revisada ? new Date().toISOString() : null,
      revisada_por: revisada ? (await sb.auth.getUser()).data.user?.id : null,
    }).eq("id", a.id);
    if (error) toast.error(errorMsg(error)); else { toast.ok(revisada ? "Alerta marcada como revisada" : "Alerta reabierta"); cargar(); }
  }

  async function bloquear(c: Coinc, bloquear: boolean, a: Alerta) {
    if (!c.lote_id) return;
    const motivo = bloquear ? `Alerta DIGEMID ${a.numero ?? ""}`.trim() : null;
    const { error } = await sb.rpc("bloquear_lote", { p_lote_id: c.lote_id, p_bloquear: bloquear, p_motivo: motivo });
    if (error) toast.error(errorMsg(error)); else { toast.ok(bloquear ? `Lote ${c.numero_lote} bloqueado para la venta` : `Lote ${c.numero_lote} liberado`); cargar(); }
  }

  if (!alertas) return <div className="py-10 text-center"><Spinner /></div>;
  const pendientes = alertas.filter((a) => !a.revisada).length;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <div className="seg">
          <button data-on={ver === "pendientes"} onClick={() => setVer("pendientes")}>Por revisar {pendientes}</button>
          <button data-on={ver === "afectan"} onClick={() => setVer("afectan")}>Afectan mi stock {porAlerta.size}</button>
          <button data-on={ver === "todas"} onClick={() => setVer("todas")}>Todas</button>
        </div>
        <p className="ml-2 text-[11.5px] text-zinc-400">Se sincroniza sola cada día. Coincidencias por N° de lote, registro sanitario o nombre.</p>
        {editor && <div className="ml-auto flex gap-2">
          <button className="btn-secondary" onClick={() => setNueva(true)}><Plus className="size-3.5" />Registrar</button>
          <button className="btn-primary" onClick={sincronizar} disabled={sinc}>{sinc ? <Spinner /> : <RefreshCw className="size-3.5" />}Sincronizar</button>
        </div>}
      </div>

      {alertas.length === 0 ? (
        <div className="card"><Empty text="Aún no hay alertas. Pulse «Sincronizar» para traerlas de DIGEMID o regístrelas a mano." /></div>
      ) : (
        <div className="card grid min-h-[480px] grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] divide-x divide-zinc-100">
          <div className="max-h-[70vh] overflow-y-auto">
            {lista.length === 0 && <Empty text="Nada en esta vista" />}
            {lista.map((a) => {
              const n = porAlerta.get(a.id)?.length ?? 0;
              return (
                <button key={a.id} onClick={() => setSel(a.id)}
                  className={clsx("block w-full border-b border-zinc-100 px-4 py-2.5 text-left hover:bg-zinc-50", actual?.id === a.id && "bg-marca-50/60")}>
                  <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                    {a.numero && <span className="font-medium text-zinc-700">N° {a.numero}</span>}
                    {a.fecha && <span>{fecha(a.fecha)}</span>}
                    {a.fuente === "manual" && <span className="badge-gray">manual</span>}
                    <span className="ml-auto">{n > 0 ? <span className="badge-red">{n} en stock</span> : a.revisada ? <span className="text-emerald-600">Revisada</span> : null}</span>
                  </div>
                  <p className={clsx("mt-0.5 line-clamp-2 text-[12.5px]", a.revisada ? "text-zinc-500" : "font-medium text-zinc-900")}>{a.titulo}</p>
                </button>
              );
            })}
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-4">
            {actual && (
              <>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11.5px] text-zinc-500">{[actual.numero && `Alerta N° ${actual.numero}`, actual.fecha && fecha(actual.fecha)].filter(Boolean).join(" · ")}</p>
                    <h3 className="mt-0.5 text-[14px] font-semibold leading-snug text-zinc-900">{actual.titulo}</h3>
                  </div>
                  {actual.url && <a href={actual.url} target="_blank" rel="noreferrer" className="btn-secondary btn-sm shrink-0"><ExternalLink className="size-3.5" />Ver en DIGEMID</a>}
                </div>
                {actual.descripcion && <p className="mt-3 whitespace-pre-line text-[12.5px] text-zinc-700">{actual.descripcion}</p>}

                <p className="label mt-5">Productos de mi inventario que coinciden</p>
                {(porAlerta.get(actual.id) ?? []).length === 0 ? (
                  <p className="rounded-md bg-zinc-50 px-3 py-2 text-[12.5px] text-zinc-500">Ninguna coincidencia automática. Revise el documento por si el producto figura con otro nombre.</p>
                ) : (
                  <table className="tbl rounded-md border border-zinc-200">
                    <thead><tr><th>Producto</th><th>Lote</th><th>Coincide por</th><th className="num">Stock</th><th /></tr></thead>
                    <tbody>
                      {porAlerta.get(actual.id)!.map((c, i) => (
                        <tr key={i}>
                          <td className="font-medium">{c.producto}</td>
                          <td className="font-mono text-[12px]">{c.numero_lote ?? "—"}</td>
                          <td><span className={c.coincide_por === "nombre" ? "badge-amber" : "badge-red"}>{COINCIDE[c.coincide_por]}</span></td>
                          <td className="num">{c.stock != null ? N(c.stock) : "—"}</td>
                          <td className="text-right">
                            {editor && c.lote_id && (c.bloqueado
                              ? <button className="btn-ghost btn-sm" onClick={() => bloquear(c, false, actual)}><LockOpen className="size-3.5" />Liberar</button>
                              : <button className="btn-danger btn-sm" onClick={() => bloquear(c, true, actual)}><Lock className="size-3.5" />Bloquear lote</button>)}
                            {c.bloqueado && !editor && <span className="badge-red">Bloqueado</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="mt-2 text-[11.5px] text-zinc-400">Un lote bloqueado no se vende ni se descuenta en el punto de venta hasta que se libere.</p>

                {editor && (
                  <div className="mt-5 flex items-center gap-3 border-t border-zinc-100 pt-3">
                    {actual.revisada
                      ? <><span className="flex items-center gap-1.5 text-[12.5px] text-emerald-700"><Check className="size-3.5" />Revisada{actual.nota_revision ? `: ${actual.nota_revision}` : ""}</span>
                          <button className="btn-ghost btn-sm ml-auto" onClick={() => revisar(actual, false)}>Reabrir</button></>
                      : <button className="btn-accent ml-auto" onClick={() => revisar(actual, true)}><Check className="size-3.5" />Marcar como revisada</button>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {nueva && <NuevaAlerta onClose={() => setNueva(false)} onOk={() => { setNueva(false); cargar(); }} />}
    </div>
  );
}

function NuevaAlerta({ onClose, onOk }: { onClose: () => void; onOk: () => void }) {
  const [f, setF] = useState({ numero: "", fecha: hoyLima(), titulo: "", descripcion: "", url: "" });
  const [guardando, setGuardando] = useState(false);
  async function guardar() {
    if (!f.titulo.trim()) { toast.error("Ingrese el título de la alerta"); return; }
    setGuardando(true);
    const { error } = await supabaseBrowser().from("alertas_sanitarias").insert({ ...f, url: f.url || null, numero: f.numero || null, fuente: "manual" });
    setGuardando(false);
    if (error) toast.error(errorMsg(error)); else { toast.ok("Alerta registrada"); onOk(); }
  }
  return (
    <Modal open onClose={onClose} title="Registrar alerta sanitaria" size="md"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={guardar} disabled={guardando}>{guardando && <Spinner />}Guardar</button></>}>
      <div className="grid grid-cols-3 gap-3">
        <Field label="N° de alerta"><input className="input" placeholder="25-2026" value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} /></Field>
        <Field label="Fecha"><input type="date" className="input" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></Field>
        <Field label="Enlace (opcional)"><input className="input" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
        <Field label="Título *" className="col-span-3"><input className="input" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} /></Field>
        <Field label="Detalle: productos, lotes, registro sanitario, motivo" className="col-span-3" hint="Los N° de lote y registros sanitarios que escriba aquí se cruzan con su inventario.">
          <textarea className="input" rows={5} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
