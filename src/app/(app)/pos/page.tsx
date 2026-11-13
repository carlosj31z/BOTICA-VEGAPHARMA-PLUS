"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  Search, Trash2, Minus, Plus, ScanBarcode, CreditCard, Banknote, Smartphone, Landmark, CheckCircle2,
  Printer, AlertTriangle, Stethoscope, X, Snowflake,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useApp } from "@/components/app-context";
import { Modal, Field, Spinner, Empty } from "@/components/ui";
import { toast } from "@/components/toast";
import { S, N, CONDICION_VENTA, METODO_PAGO, errorMsg, fecha } from "@/lib/format";
import type { Producto } from "@/lib/types";

type Linea = {
  key: string; producto: Producto; presentacion: "unidad" | "empaque"; cantidad: number; descuento: number;
};
type Pago = {
  metodo: string; monto: number; recibido?: number; pos_proveedor?: string; numero_operacion?: string; marca_tarjeta?: string; ultimos4?: string;
};
type Cliente = { tipo_documento: string; numero_documento: string; nombre: string; direccion: string };

const CLIENTE_VACIO: Cliente = { tipo_documento: "1", numero_documento: "", nombre: "", direccion: "" };
const RECETA_VACIA = { numero: "", fecha_receta: "", paciente_nombre: "", paciente_documento: "", medico_nombre: "", medico_cmp: "", establecimiento_origen: "" };
const POS_PROVEEDORES = ["izipay", "niubiz", "openpay", "culqi", "mercadopago", "otro"];
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const precioDe = (l: Linea) => (l.presentacion === "empaque" ? Number(l.producto.precio_empaque) : Number(l.producto.precio_unidad));
const totalLinea = (l: Linea) => r2(l.cantidad * precioDe(l) - (l.descuento || 0));
const unidadesDe = (l: Linea) => l.cantidad * (l.presentacion === "empaque" ? l.producto.unidades_por_empaque : 1);
const CONDICION_BADGE: Record<string, string> = { libre: "", receta: "badge-blue", receta_retenida: "badge-violet", controlado: "badge-red" };

export default function POS() {
  const { turno, empresa, puede } = useApp();
  const sb = supabaseBrowser();
  const igvPct = Number(empresa.igv_porcentaje ?? 18);

  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [sel, setSel] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const [carrito, setCarrito] = useState<Linea[]>([]);
  const [tipo, setTipo] = useState<"03" | "01" | "NV">("03");
  const [cliente, setCliente] = useState<Cliente>(CLIENTE_VACIO);
  const [receta, setReceta] = useState(RECETA_VACIA);
  const [cobrando, setCobrando] = useState(false);
  const [resultado, setResultado] = useState<{ venta_id: number; comprobante: string; total: number; vuelto: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const restaurado = useRef(false);

  // Persistencia del carrito: una recarga o corte de luz no pierde la venta en curso.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("pos:carrito");
      if (raw) { const d = JSON.parse(raw); setCarrito(d.carrito ?? []); setTipo(d.tipo ?? "03"); setCliente(d.cliente ?? CLIENTE_VACIO); setReceta(d.receta ?? RECETA_VACIA); }
    } catch {}
    restaurado.current = true;
  }, []);
  useEffect(() => {
    if (!restaurado.current) return;
    try { localStorage.setItem("pos:carrito", JSON.stringify({ carrito, tipo, cliente, receta })); } catch {}
  }, [carrito, tipo, cliente, receta]);

  // Búsqueda con debounce
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResultados([]); return; }
    const t = setTimeout(async () => {
      setBuscando(true);
      const safe = term.replace(/[,()%]/g, " ");
      const { data, error } = await sb.from("v_productos").select("*").eq("activo", true)
        .or(`nombre.ilike.%${safe}%,principio_activo.ilike.%${safe}%,codigo.eq.${safe},codigo_barras.eq.${safe}`)
        .order("nombre").limit(30);
      setBuscando(false);
      if (error) { toast.error(errorMsg(error)); return; }
      const t0 = term.toUpperCase();
      const rank = (p: Producto) => (p.nombre.toUpperCase().startsWith(t0) ? 0 : p.nombre.toUpperCase().includes(t0) ? 1 : 2) + ((p.stock_vendible ?? 0) > 0 ? 0 : 3);
      setResultados([...(data ?? [])].sort((a, b) => rank(a) - rank(b))); setSel(0);
    }, 180);
    return () => clearTimeout(t);
  }, [q, sb]);

  const agregar = useCallback((p: Producto, presentacion: "unidad" | "empaque" = "unidad") => {
    if (presentacion === "empaque" && p.unidades_por_empaque <= 1) presentacion = "unidad";
    const precio = presentacion === "empaque" ? p.precio_empaque : p.precio_unidad;
    if (!Number(precio)) { toast.error(`${p.nombre} no tiene precio de ${presentacion === "empaque" ? "caja" : "unidad"}.`); return; }
    if ((p.stock_vendible ?? 0) <= 0) { toast.error(`${p.nombre} no tiene stock vendible.`); return; }
    setCarrito((c) => {
      const i = c.findIndex((l) => l.producto.id === p.id && l.presentacion === presentacion);
      if (i >= 0) { const n = [...c]; n[i] = { ...n[i], cantidad: n[i].cantidad + 1 }; return n; }
      return [...c, { key: `${p.id}-${presentacion}-${Date.now()}`, producto: p, presentacion, cantidad: 1, descuento: 0 }];
    });
    setQ(""); setResultados([]); searchRef.current?.focus();
  }, []);

  async function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, resultados.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const term = q.trim();
      // Lector de código de barras: coincidencia exacta inmediata
      if (/^\d{6,14}$/.test(term)) {
        const { data } = await sb.from("v_productos").select("*").eq("activo", true).or(`codigo_barras.eq.${term},codigo.eq.${term}`).limit(1);
        if (data?.[0]) { agregar(data[0], e.shiftKey ? "empaque" : "unidad"); return; }
      }
      if (resultados[sel]) agregar(resultados[sel], e.shiftKey ? "empaque" : "unidad");
    } else if (e.key === "Escape") { setQ(""); setResultados([]); }
  }

  const totales = useMemo(() => {
    let grav = 0, exo = 0, ina = 0, igv = 0, desc = 0, total = 0;
    for (const l of carrito) {
      const t = totalLinea(l); total += t; desc += l.descuento || 0;
      if (l.producto.afectacion_igv === "gravado") { const v = r2(t / (1 + igvPct / 100)); grav += v; igv += r2(t - v); }
      else if (l.producto.afectacion_igv === "exonerado") exo += t; else ina += t;
    }
    return { grav: r2(grav), exo: r2(exo), ina: r2(ina), igv: r2(igv), desc: r2(desc), total: r2(total) };
  }, [carrito, igvPct]);

  const requiereReceta = carrito.some((l) => l.producto.condicion_venta !== "libre");
  const hayControlado = carrito.some((l) => l.producto.condicion_venta === "controlado");
  const limiteDni = Number(empresa.monto_boleta_requiere_dni ?? 700);

  function validar(): string | null {
    if (!turno) return "Abra un turno de caja antes de vender.";
    if (!carrito.length) return "Agregue productos a la venta.";
    for (const l of carrito) {
      if (unidadesDe(l) > (l.producto.stock_vendible ?? 0)) return `Stock insuficiente de ${l.producto.nombre} (disponible ${l.producto.stock_vendible} u.).`;
      if (totalLinea(l) <= 0) return `El descuento de ${l.producto.nombre} supera el importe.`;
    }
    if (tipo === "01") {
      if (!/^(10|15|17|20)\d{9}$/.test(cliente.numero_documento)) return "La factura requiere un RUC válido de 11 dígitos.";
      if (!cliente.nombre.trim() || !cliente.direccion.trim()) return "Ingrese razón social y dirección fiscal del cliente.";
    }
    if (tipo === "03" && totales.total > limiteDni && !cliente.numero_documento) return `Boletas mayores a ${S(limiteDni)} requieren el documento del cliente.`;
    if (cliente.numero_documento && cliente.tipo_documento === "1" && !/^\d{8}$/.test(cliente.numero_documento)) return "El DNI debe tener 8 dígitos.";
    if (cliente.numero_documento && !cliente.nombre.trim()) return "Ingrese el nombre del cliente.";
    if (requiereReceta && (!receta.paciente_nombre.trim() || !receta.medico_nombre.trim() || !receta.medico_cmp.trim()))
      return "Complete los datos de la receta: paciente, médico y CMP.";
    if (hayControlado && !puede("admin", "quimico")) return "Los productos controlados solo los dispensa el químico farmacéutico.";
    return null;
  }

  function abrirCobro() {
    const err = validar();
    if (err) { toast.error(err); return; }
    setCobrando(true);
  }

  function nuevaVenta() {
    setCarrito([]); setCliente(CLIENTE_VACIO); setReceta(RECETA_VACIA); setTipo("03"); setResultado(null);
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  // Atajos
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (resultado) { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); nuevaVenta(); } return; }
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "F9" && !cobrando) { e.preventDefault(); abrirCobro(); }
      if (e.key === "F4") { e.preventDefault(); document.getElementById("cli-doc")?.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  async function buscarCliente() {
    if (!cliente.numero_documento) return;
    const tipoDoc = cliente.numero_documento.length === 11 ? "6" : cliente.tipo_documento;
    const { data } = await sb.from("clientes").select("*").eq("numero_documento", cliente.numero_documento).limit(1);
    if (data?.[0]) setCliente({ tipo_documento: data[0].tipo_documento, numero_documento: data[0].numero_documento, nombre: data[0].nombre, direccion: data[0].direccion ?? "" });
    else setCliente((c) => ({ ...c, tipo_documento: tipoDoc }));
  }

  const upd = (key: string, patch: Partial<Linea>) => setCarrito((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div className="-m-5 flex h-[calc(100vh-3rem)]">
      {/* Columna principal */}
      <div className="flex min-w-0 flex-1 flex-col p-4">
        {!turno && (
          <div className="mb-3 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-800">
            <span className="flex items-center gap-2"><AlertTriangle className="size-4" />No tiene un turno de caja abierto. Ábralo para poder cobrar.</span>
            <Link href="/caja" className="btn-primary btn-sm">Abrir turno</Link>
          </div>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
          <input ref={searchRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey}
            placeholder="Buscar por nombre, principio activo, código o escanear código de barras…"
            className="input h-12 rounded-xl pl-11 pr-28 text-[15px] shadow-sm" />
          <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-slate-400">
            {buscando ? <Spinner /> : <ScanBarcode className="size-5" />}<span className="kbd">F2</span>
          </div>
          {resultados.length > 0 && (
            <div className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-[60vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
              <div className="sticky top-0 flex justify-between border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-[11px] text-slate-500">
                <span>↑↓ navegar · <b>Enter</b> agregar unidad · <b>Shift+Enter</b> agregar caja</span><span>{resultados.length} resultados</span>
              </div>
              {resultados.map((p, i) => {
                const sinStock = (p.stock_vendible ?? 0) <= 0;
                return (
                  <div key={p.id} onMouseEnter={() => setSel(i)}
                    className={clsx("flex items-center gap-4 border-b border-slate-50 px-4 py-2.5", i === sel && "bg-marca-50", sinStock && "opacity-60")}>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-[13.5px] font-medium text-slate-900">
                        {p.nombre} {p.concentracion}
                        {p.condicion_venta !== "libre" && <span className={CONDICION_BADGE[p.condicion_venta]}>{CONDICION_VENTA[p.condicion_venta]}</span>}
                        {p.refrigerado && <Snowflake className="size-3.5 text-sky-500" />}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {[p.principio_activo, p.forma_farmaceutica, p.laboratorio, p.presentacion].filter(Boolean).join(" · ")}
                        {p.proximo_vencimiento && <> · vence {fecha(p.proximo_vencimiento)}</>}
                      </p>
                    </div>
                    <div className="w-20 text-right">
                      <p className={clsx("text-[13px] font-semibold tabular-nums", sinStock ? "text-rose-600" : "text-slate-700")}>{N(p.stock_vendible)}</p>
                      <p className="text-[10.5px] text-slate-400">unidades</p>
                    </div>
                    <button onClick={() => agregar(p, "unidad")} disabled={sinStock} className="btn-secondary h-11 w-24 flex-col gap-0 leading-tight">
                      <span className="text-[13px] font-semibold tabular-nums">{S(p.precio_unidad)}</span><span className="text-[10px] text-slate-500">Unidad</span>
                    </button>
                    {p.unidades_por_empaque > 1 && (
                      <button onClick={() => agregar(p, "empaque")} disabled={sinStock || !Number(p.precio_empaque)} className="btn-secondary h-11 w-24 flex-col gap-0 leading-tight">
                        <span className="text-[13px] font-semibold tabular-nums">{S(p.precio_empaque)}</span><span className="text-[10px] text-slate-500">Caja x{p.unidades_por_empaque}</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card mt-3 flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {carrito.length === 0 ? (
              <Empty text="Escanee o busque productos para iniciar la venta" icon={<ScanBarcode className="size-10" />} />
            ) : (
              <table className="tbl">
                <thead><tr><th className="w-8">#</th><th>Producto</th><th className="w-36">Presentación</th><th className="w-32 text-center">Cantidad</th>
                  <th className="num w-24">Precio</th><th className="num w-24">Desc. S/</th><th className="num w-28">Importe</th><th className="w-10" /></tr></thead>
                <tbody>
                  {carrito.map((l, i) => {
                    const exceso = unidadesDe(l) > (l.producto.stock_vendible ?? 0);
                    return (
                      <tr key={l.key}>
                        <td className="text-slate-400">{i + 1}</td>
                        <td>
                          <p className="font-medium text-slate-900">{l.producto.nombre} {l.producto.concentracion}</p>
                          <p className="text-xs text-slate-500">
                            {l.producto.laboratorio}
                            {l.producto.condicion_venta !== "libre" && <span className={`${CONDICION_BADGE[l.producto.condicion_venta]} ml-2`}>{CONDICION_VENTA[l.producto.condicion_venta]}</span>}
                            {exceso && <span className="badge-red ml-2">Stock: {l.producto.stock_vendible} u.</span>}
                          </p>
                        </td>
                        <td>
                          {l.producto.unidades_por_empaque > 1 ? (
                            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs">
                              {(["unidad", "empaque"] as const).map((pr) => (
                                <button key={pr} onClick={() => upd(l.key, { presentacion: pr })}
                                  disabled={pr === "empaque" && !Number(l.producto.precio_empaque)}
                                  className={clsx("rounded-md px-2 py-1 disabled:opacity-40", l.presentacion === pr ? "bg-marca-600 text-white" : "text-slate-600 hover:bg-slate-100")}>
                                  {pr === "unidad" ? "Unidad" : `Caja x${l.producto.unidades_por_empaque}`}
                                </button>
                              ))}
                            </div>
                          ) : <span className="text-xs text-slate-500">Unidad</span>}
                        </td>
                        <td>
                          <div className="flex items-center justify-center gap-1">
                            <button className="btn-ghost btn-sm px-1.5" onClick={() => upd(l.key, { cantidad: Math.max(1, l.cantidad - 1) })}><Minus className="size-3.5" /></button>
                            <input className="input h-8 w-14 text-center tabular-nums" inputMode="numeric" value={l.cantidad}
                              onChange={(e) => upd(l.key, { cantidad: Math.max(1, parseInt(e.target.value.replace(/\D/g, "")) || 1) })} />
                            <button className="btn-ghost btn-sm px-1.5" onClick={() => upd(l.key, { cantidad: l.cantidad + 1 })}><Plus className="size-3.5" /></button>
                          </div>
                        </td>
                        <td className="num">{S(precioDe(l))}</td>
                        <td className="num">
                          <input className="input h-8 w-20 text-right tabular-nums" inputMode="decimal" value={l.descuento || ""} placeholder="0.00"
                            onChange={(e) => upd(l.key, { descuento: Math.max(0, parseFloat(e.target.value) || 0) })} />
                        </td>
                        <td className="num text-[14px] font-semibold">{S(totalLinea(l))}</td>
                        <td><button onClick={() => setCarrito((c) => c.filter((x) => x.key !== l.key))} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-4" /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {carrito.length > 0 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
              <span>{carrito.length} ítems · {N(carrito.reduce((a, l) => a + unidadesDe(l), 0))} unidades</span>
              <button onClick={() => setCarrito([])} className="btn-ghost btn-sm text-rose-600 hover:bg-rose-50"><X className="size-3.5" />Vaciar</button>
            </div>
          )}
        </div>

        {requiereReceta && (
          <div className="card mt-3 border-sky-200 p-4">
            <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-sky-800">
              <Stethoscope className="size-4" />Datos de la receta médica
              {carrito.some((l) => ["receta_retenida", "controlado"].includes(l.producto.condicion_venta)) && <span className="badge-violet">La receta queda retenida</span>}
            </p>
            <div className="grid grid-cols-6 gap-3">
              <Field label="Paciente *" className="col-span-2"><input className="input" value={receta.paciente_nombre} onChange={(e) => setReceta({ ...receta, paciente_nombre: e.target.value })} /></Field>
              <Field label="DNI paciente"><input className="input" value={receta.paciente_documento} onChange={(e) => setReceta({ ...receta, paciente_documento: e.target.value })} /></Field>
              <Field label="Médico prescriptor *" className="col-span-2"><input className="input" value={receta.medico_nombre} onChange={(e) => setReceta({ ...receta, medico_nombre: e.target.value })} /></Field>
              <Field label="CMP / COP *"><input className="input" value={receta.medico_cmp} onChange={(e) => setReceta({ ...receta, medico_cmp: e.target.value })} /></Field>
              <Field label="N° receta"><input className="input" value={receta.numero} onChange={(e) => setReceta({ ...receta, numero: e.target.value })} /></Field>
              <Field label="Fecha receta"><input type="date" className="input" value={receta.fecha_receta} onChange={(e) => setReceta({ ...receta, fecha_receta: e.target.value })} /></Field>
              <Field label="Establecimiento de origen" className="col-span-4"><input className="input" value={receta.establecimiento_origen} onChange={(e) => setReceta({ ...receta, establecimiento_origen: e.target.value })} /></Field>
            </div>
          </div>
        )}
      </div>

      {/* Panel derecho */}
      <aside className="flex w-[360px] shrink-0 flex-col border-l border-slate-200 bg-white">
        <div className="space-y-4 overflow-y-auto p-4">
          <div>
            <p className="label">Comprobante</p>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
              {([["03", "Boleta"], ["01", "Factura"], ["NV", "Nota venta"]] as const).map(([v, l]) => (
                <button key={v} onClick={() => { setTipo(v); if (v === "01") setCliente((c) => ({ ...c, tipo_documento: "6" })); }}
                  className={clsx("rounded-md py-1.5 text-[13px] font-medium", tipo === v ? "bg-white text-marca-700 shadow-sm" : "text-slate-600 hover:text-slate-900")}>{l}</button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            <p className="label mb-0 flex justify-between">Cliente <span className="kbd">F4</span></p>
            <div className="flex gap-2">
              <select className="input w-28" value={cliente.tipo_documento} onChange={(e) => setCliente({ ...cliente, tipo_documento: e.target.value })} disabled={tipo === "01"}>
                <option value="1">DNI</option><option value="6">RUC</option><option value="4">C.E.</option><option value="7">Pasaporte</option>
              </select>
              <input id="cli-doc" className="input" placeholder={tipo === "01" ? "RUC (obligatorio)" : "Opcional"} value={cliente.numero_documento} inputMode="numeric"
                onChange={(e) => setCliente({ ...cliente, numero_documento: e.target.value.trim() })} onBlur={buscarCliente}
                onKeyDown={(e) => e.key === "Enter" && buscarCliente()} />
            </div>
            {(cliente.numero_documento || tipo === "01") && (
              <>
                <input className="input" placeholder={tipo === "01" ? "Razón social" : "Nombre completo"} value={cliente.nombre} onChange={(e) => setCliente({ ...cliente, nombre: e.target.value })} />
                <input className="input" placeholder={tipo === "01" ? "Dirección fiscal (obligatoria)" : "Dirección (opcional)"} value={cliente.direccion} onChange={(e) => setCliente({ ...cliente, direccion: e.target.value })} />
              </>
            )}
            {!cliente.numero_documento && tipo !== "01" && <p className="text-xs text-slate-400">Se emitirá a CLIENTES VARIOS (hasta {S(limiteDni)}).</p>}
          </div>
        </div>

        <div className="mt-auto border-t border-slate-200 bg-slate-50/70 p-4">
          <dl className="space-y-1 text-[13px]">
            {totales.desc > 0 && <div className="flex justify-between text-slate-500"><dt>Descuentos</dt><dd className="tabular-nums">-{S(totales.desc)}</dd></div>}
            <div className="flex justify-between text-slate-500"><dt>Op. gravada</dt><dd className="tabular-nums">{S(totales.grav)}</dd></div>
            {totales.exo > 0 && <div className="flex justify-between text-slate-500"><dt>Op. exonerada</dt><dd className="tabular-nums">{S(totales.exo)}</dd></div>}
            {totales.ina > 0 && <div className="flex justify-between text-slate-500"><dt>Op. inafecta</dt><dd className="tabular-nums">{S(totales.ina)}</dd></div>}
            <div className="flex justify-between text-slate-500"><dt>IGV ({igvPct}%)</dt><dd className="tabular-nums">{S(totales.igv)}</dd></div>
          </dl>
          <div className="mt-2 flex items-baseline justify-between border-t border-slate-200 pt-2">
            <span className="text-sm font-medium text-slate-600">Total a pagar</span>
            <span className="text-3xl font-bold tabular-nums tracking-tight text-slate-900">{S(totales.total)}</span>
          </div>
          <button onClick={abrirCobro} disabled={!carrito.length || !turno} className="btn-primary mt-3 h-14 w-full text-base">
            <Banknote className="size-5" />Cobrar <span className="kbd ml-1 border-white/30 bg-white/10 text-white shadow-none">F9</span>
          </button>
        </div>
      </aside>

      {cobrando && (
        <ModalCobro total={totales.total} onClose={() => setCobrando(false)}
          onConfirm={async (pagos) => {
            const payload: any = {
              tipo,
              items: carrito.map((l) => ({ producto_id: l.producto.id, presentacion: l.presentacion, cantidad: l.cantidad, descuento: l.descuento || 0 })),
              pagos,
            };
            if (cliente.numero_documento) payload.cliente = { ...cliente, tipo_documento: tipo === "01" ? "6" : cliente.tipo_documento };
            if (requiereReceta) payload.receta = { ...receta, fecha_receta: receta.fecha_receta || null };
            const { data, error } = await sb.rpc("registrar_venta", { p: payload });
            if (error) { toast.error(errorMsg(error)); return false; }
            const vuelto = pagos.reduce((a, p) => a + (p.metodo === "efectivo" && p.recibido ? Math.max(0, p.recibido - p.monto) : 0), 0);
            setCobrando(false);
            setResultado({ ...data, vuelto: r2(vuelto) });
            try { localStorage.removeItem("pos:carrito"); } catch {}
            // Envío a SUNAT en segundo plano: no bloquea la atención
            if (tipo !== "NV") fetch("/api/sunat/enviar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ venta_id: data.venta_id }) }).catch(() => {});
            return true;
          }} />
      )}

      {resultado && (
        <Modal open onClose={nuevaVenta} title="Venta registrada" size="sm"
          footer={<>
            <button className="btn-secondary" onClick={() => window.open(`/ventas/${resultado.venta_id}/ticket`, "ticket", "width=420,height=700")}><Printer className="size-4" />Imprimir ticket</button>
            <button className="btn-primary" onClick={nuevaVenta} autoFocus>Nueva venta <span className="kbd ml-1 border-white/30 bg-white/10 text-white shadow-none">Enter</span></button>
          </>}>
          <div className="py-2 text-center">
            <CheckCircle2 className="mx-auto size-12 text-emerald-500" />
            <p className="mt-2 text-lg font-semibold text-slate-900">{resultado.comprobante}</p>
            <p className="text-[13px] text-slate-500">Total cobrado {S(resultado.total)}</p>
            {resultado.vuelto > 0 && (
              <div className="mx-auto mt-4 w-fit rounded-xl bg-amber-50 px-8 py-3 ring-1 ring-amber-200">
                <p className="text-xs font-medium text-amber-700">Vuelto</p>
                <p className="text-3xl font-bold tabular-nums text-amber-800">{S(resultado.vuelto)}</p>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function ModalCobro({ total, onClose, onConfirm }: { total: number; onClose: () => void; onConfirm: (p: Pago[]) => Promise<boolean> }) {
  const posDefault = (() => { try { return localStorage.getItem("pos:proveedor") || "izipay"; } catch { return "izipay"; } })();
  const [pagos, setPagos] = useState<Pago[]>([{ metodo: "efectivo", monto: total, recibido: undefined }]);
  const [enviando, setEnviando] = useState(false);
  const pagado = r2(pagos.reduce((a, p) => a + (p.monto || 0), 0));
  const falta = r2(total - pagado);
  const efectivo = pagos.find((p) => p.metodo === "efectivo");
  const vuelto = efectivo?.recibido ? r2(Math.max(0, efectivo.recibido - efectivo.monto)) : 0;

  function setMetodo(metodo: string) {
    // Un solo medio: reemplaza. Para pago mixto, "Agregar otro medio".
    if (pagos.length === 1) setPagos([{ metodo, monto: total, pos_proveedor: metodo.startsWith("tarjeta") ? posDefault : undefined }]);
  }
  function agregarMedio() {
    if (falta <= 0) return;
    setPagos([...pagos, { metodo: "tarjeta_debito", monto: falta, pos_proveedor: posDefault }]);
  }
  const upd = (i: number, patch: Partial<Pago>) => setPagos((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function confirmar() {
    if (falta !== 0) { toast.error(falta > 0 ? `Falta asignar ${S(falta)}` : `Los pagos exceden el total en ${S(-falta)}`); return; }
    for (const p of pagos) {
      if (p.metodo.startsWith("tarjeta") && !p.numero_operacion?.trim()) { toast.error("Ingrese el N° de operación del voucher del POS."); return; }
      if (p.metodo === "efectivo" && p.recibido !== undefined && p.recibido < p.monto) { toast.error("El efectivo recibido es menor al monto."); return; }
    }
    const t = pagos.find((p) => p.pos_proveedor);
    if (t?.pos_proveedor) try { localStorage.setItem("pos:proveedor", t.pos_proveedor); } catch {}
    setEnviando(true);
    const ok = await onConfirm(pagos.map((p) => ({ ...p, monto: r2(p.monto) })));
    if (!ok) setEnviando(false);
  }

  const METODOS = [
    { v: "efectivo", l: "Efectivo", i: Banknote }, { v: "tarjeta_debito", l: "Débito", i: CreditCard }, { v: "tarjeta_credito", l: "Crédito", i: CreditCard },
    { v: "yape", l: "Yape", i: Smartphone }, { v: "plin", l: "Plin", i: Smartphone }, { v: "transferencia", l: "Transfer.", i: Landmark },
  ];

  return (
    <Modal open onClose={onClose} title="Cobrar venta" size="md"
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn-primary btn-lg min-w-48" onClick={confirmar} disabled={enviando}>
          {enviando ? <Spinner /> : <CheckCircle2 className="size-4" />}Confirmar cobro
        </button>
      </>}>
      <div className="mb-4 flex items-end justify-between rounded-xl bg-slate-900 px-5 py-4 text-white">
        <div><p className="text-xs text-slate-400">Total</p><p className="text-3xl font-bold tabular-nums">{S(total)}</p></div>
        {vuelto > 0 && <div className="text-right"><p className="text-xs text-amber-300">Vuelto</p><p className="text-2xl font-bold tabular-nums text-amber-300">{S(vuelto)}</p></div>}
        {falta !== 0 && <div className="text-right"><p className="text-xs text-rose-300">{falta > 0 ? "Falta" : "Exceso"}</p><p className="text-xl font-semibold tabular-nums text-rose-300">{S(Math.abs(falta))}</p></div>}
      </div>

      {pagos.length === 1 && (
        <div className="mb-4 grid grid-cols-6 gap-2">
          {METODOS.map((m) => (
            <button key={m.v} onClick={() => setMetodo(m.v)}
              className={clsx("flex flex-col items-center gap-1 rounded-lg border py-2.5 text-xs font-medium transition",
                pagos[0].metodo === m.v ? "border-marca-500 bg-marca-50 text-marca-700 ring-2 ring-marca-500/20" : "border-slate-200 text-slate-600 hover:border-slate-300")}>
              <m.i className="size-5" />{m.l}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {pagos.map((p, i) => (
          <div key={i} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-end gap-2">
              {pagos.length > 1 && (
                <Field label="Medio" className="w-40">
                  <select className="input" value={p.metodo} onChange={(e) => upd(i, { metodo: e.target.value, pos_proveedor: e.target.value.startsWith("tarjeta") ? posDefault : undefined })}>
                    {Object.entries(METODO_PAGO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
              )}
              <Field label={`Monto ${METODO_PAGO[p.metodo].toLowerCase()}`} className="w-36">
                <input className="input text-right tabular-nums" inputMode="decimal" value={p.monto} onChange={(e) => upd(i, { monto: parseFloat(e.target.value) || 0 })} />
              </Field>
              {p.metodo === "efectivo" && (
                <Field label="Recibido" className="flex-1">
                  <input className="input text-right tabular-nums" inputMode="decimal" autoFocus placeholder="Monto entregado" value={p.recibido ?? ""}
                    onChange={(e) => upd(i, { recibido: e.target.value ? parseFloat(e.target.value) : undefined })}
                    onKeyDown={(e) => e.key === "Enter" && confirmar()} />
                </Field>
              )}
              {pagos.length > 1 && <button className="btn-ghost h-9 px-2 text-rose-600" onClick={() => setPagos(pagos.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>}
            </div>
            {p.metodo === "efectivo" && (
              <div className="mt-2 flex gap-1.5">
                {[p.monto, 10, 20, 50, 100, 200].filter((v, k, a) => v >= p.monto && a.indexOf(v) === k).map((v) => (
                  <button key={v} onClick={() => upd(i, { recibido: v })} className="btn-secondary btn-sm tabular-nums">{v === p.monto ? "Exacto" : `S/ ${v}`}</button>
                ))}
              </div>
            )}
            {p.metodo.startsWith("tarjeta") && (
              <div className="mt-2 grid grid-cols-4 gap-2">
                <Field label="POS">
                  <select className="input" value={p.pos_proveedor} onChange={(e) => upd(i, { pos_proveedor: e.target.value })}>
                    {POS_PROVEEDORES.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
                  </select>
                </Field>
                <Field label="N° operación *"><input className="input" autoFocus value={p.numero_operacion ?? ""} onChange={(e) => upd(i, { numero_operacion: e.target.value })} /></Field>
                <Field label="Marca">
                  <select className="input" value={p.marca_tarjeta ?? ""} onChange={(e) => upd(i, { marca_tarjeta: e.target.value })}>
                    <option value="">—</option><option>Visa</option><option>Mastercard</option><option>American Express</option><option>Diners</option>
                  </select>
                </Field>
                <Field label="Últimos 4"><input className="input" maxLength={4} inputMode="numeric" value={p.ultimos4 ?? ""} onChange={(e) => upd(i, { ultimos4: e.target.value.replace(/\D/g, "") })} /></Field>
              </div>
            )}
            {["yape", "plin", "transferencia"].includes(p.metodo) && (
              <div className="mt-2"><Field label="N° de operación (opcional)"><input className="input" value={p.numero_operacion ?? ""} onChange={(e) => upd(i, { numero_operacion: e.target.value })} /></Field></div>
            )}
          </div>
        ))}
        {falta > 0 && <button className="btn-secondary w-full border-dashed" onClick={agregarMedio}><Plus className="size-4" />Agregar otro medio de pago ({S(falta)})</button>}
        {pagos.length === 1 && pagos[0].metodo === "efectivo" && (
          <button className="text-xs text-marca-700 hover:underline" onClick={() => setPagos([{ ...pagos[0], monto: r2(total / 2) }, { metodo: "tarjeta_debito", monto: r2(total - r2(total / 2)), pos_proveedor: posDefault }])}>
            Pago mixto (efectivo + tarjeta)
          </button>
        )}
      </div>
    </Modal>
  );
}
