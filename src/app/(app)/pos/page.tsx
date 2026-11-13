"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Search, Trash2, Minus, Plus, ScanBarcode, Printer, Snowflake, X, Check, BookOpen, Camera, Smartphone, MessageCircle } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useApp } from "@/components/app-context";
import { Modal, Field, Spinner } from "@/components/ui";
import { toast } from "@/components/toast";
import { S, N, CONDICION_VENTA, METODO_PAGO, errorMsg, fecha } from "@/lib/format";
import { FichasProducto, ModalFicha } from "@/components/ficha-medicamento";
import { ModalCamara, pitido, useCodigosRemotos, useLectorUSB } from "@/components/escaner";
import type { Producto } from "@/lib/types";

type Pres = "unidad" | "blister" | "empaque";
type Linea = { key: string; producto: Producto; presentacion: Pres; cantidad: number; descuento: number };
type Pago = { metodo: string; monto: number; recibido?: number; pos_proveedor?: string; numero_operacion?: string; marca_tarjeta?: string; ultimos4?: string };
type Cliente = { tipo_documento: string; numero_documento: string; nombre: string; direccion: string };
type Ultima = { venta_id: number; comprobante: string; total: number; vuelto: number };

const CLIENTE_VACIO: Cliente = { tipo_documento: "1", numero_documento: "", nombre: "", direccion: "" };
const RECETA_VACIA = { numero: "", fecha_receta: "", paciente_nombre: "", paciente_documento: "", medico_nombre: "", medico_cmp: "", establecimiento_origen: "" };
const POS_PROVEEDORES = ["izipay", "niubiz", "openpay", "culqi", "mercadopago", "otro"];
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const factorDe = (p: Producto, pr: Pres) => (pr === "empaque" ? p.unidades_por_empaque : pr === "blister" ? Number(p.unidades_por_blister ?? 1) : 1);
const precioPres = (p: Producto, pr: Pres) => Number(pr === "empaque" ? p.precio_empaque : pr === "blister" ? p.precio_blister ?? 0 : p.precio_unidad);
const presentaciones = (p: Producto): Pres[] => ["unidad", ...(Number(p.unidades_por_blister ?? 1) > 1 && Number(p.precio_blister) > 0 ? ["blister" as Pres] : []), ...(p.unidades_por_empaque > 1 && Number(p.precio_empaque) > 0 ? ["empaque" as Pres] : [])];
const etiquetaPres = (p: Producto, pr: Pres) => (pr === "unidad" ? "Unid." : pr === "blister" ? `Blíster x${p.unidades_por_blister}` : `Caja x${p.unidades_por_empaque}`);
const precioDe = (l: Linea) => precioPres(l.producto, l.presentacion);
const totalLinea = (l: Linea) => r2(l.cantidad * precioDe(l) - (l.descuento || 0));
const unidadesDe = (l: Linea) => l.cantidad * factorDe(l.producto, l.presentacion);
const CONDICION_BADGE: Record<string, string> = { libre: "", receta: "badge-blue", receta_retenida: "badge-violet", controlado: "badge-red" };
const leer = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };
const enCampoTexto = (el: Element | null) => !!el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);

export default function POS() {
  const { turno, empresa, perfil, puede } = useApp();
  const sb = supabaseBrowser();
  const igvPct = Number(empresa.igv_porcentaje ?? 18);

  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [sel, setSel] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const [carrito, setCarrito] = useState<Linea[]>([]);
  const [fila, setFila] = useState(0);
  const [tipo, setTipo] = useState<"03" | "01" | "NV">("03");
  const [cliente, setCliente] = useState<Cliente>(CLIENTE_VACIO);
  const [estadoDoc, setEstadoDoc] = useState<"" | "buscando" | "ok" | "nuevo">("");
  const [receta, setReceta] = useState(RECETA_VACIA);
  const [cobrando, setCobrando] = useState(false);
  const [ultima, setUltima] = useState<Ultima | null>(null);
  const [autoImprimir, setAutoImprimir] = useState(false);
  const [fichaDe, setFichaDe] = useState<Producto | null>(null);
  const [camara, setCamara] = useState(false);
  const [alternativasDe, setAlternativasDe] = useState<Producto | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const restaurado = useRef(false);

  // El carrito sobrevive a una recarga o a un corte de luz.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("pos:carrito");
      if (raw) { const d = JSON.parse(raw); setCarrito(d.carrito ?? []); setTipo(d.tipo ?? "03"); setCliente(d.cliente ?? CLIENTE_VACIO); setReceta(d.receta ?? RECETA_VACIA); }
    } catch {}
    setAutoImprimir(leer("pos:auto-imprimir", "0") === "1");
    restaurado.current = true;
  }, []);
  useEffect(() => {
    if (restaurado.current) guardar("pos:carrito", JSON.stringify({ carrito, tipo, cliente, receta }));
  }, [carrito, tipo, cliente, receta]);
  useEffect(() => { setFila((f) => Math.min(Math.max(0, f), Math.max(0, carrito.length - 1))); }, [carrito.length]);

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
    }, 160);
    return () => clearTimeout(t);
  }, [q, sb]);

  const agregar = useCallback((p: Producto, presentacion: Pres = "unidad"): boolean => {
    if (!presentaciones(p).includes(presentacion)) presentacion = "unidad";
    if (!precioPres(p, presentacion)) { toast.error(`${p.nombre} no tiene precio de venta.`); return false; }
    if ((p.stock_vendible ?? 0) <= 0) { toast.error(`${p.nombre} no tiene stock vendible.`); return false; }
    setCarrito((c) => {
      const i = c.findIndex((l) => l.producto.id === p.id && l.presentacion === presentacion);
      if (i >= 0) { const n = [...c]; n[i] = { ...n[i], cantidad: n[i].cantidad + 1 }; setFila(i); return n; }
      setFila(c.length);
      return [...c, { key: `${p.id}-${presentacion}-${Date.now()}`, producto: p, presentacion, cantidad: 1, descuento: 0 }];
    });
    setQ(""); setResultados([]);
    if (!camara) searchRef.current?.focus();
    return true;
  }, [camara]);

  /** Código leído por lector USB, cámara o celular: coincidencia exacta por código de barras o código interno. */
  const agregarPorCodigo = useCallback(async (codigo: string, presentacion: Pres = "unidad") => {
    const c = codigo.trim().replace(/[,()%]/g, "");
    if (!c) return false;
    const { data } = await sb.from("v_productos").select("*").eq("activo", true).or(`codigo_barras.eq.${c},codigo.eq.${c}`).limit(1);
    if (!data?.[0]) { pitido(false); toast.error(`Código ${c} no registrado.`); return false; }
    const ok = agregar(data[0], presentacion);
    pitido(ok);
    return ok;
  }, [sb, agregar]);

  useLectorUSB((c) => agregarPorCodigo(c), !cobrando && !fichaDe);
  const celulares = useCodigosRemotos(perfil.id, (c) => agregarPorCodigo(c));

  const upd = (key: string, patch: Partial<Linea>) => setCarrito((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const quitar = (key: string) => setCarrito((c) => c.filter((x) => x.key !== key));
  const alternarPresentacion = (l: Linea) => {
    const ps = presentaciones(l.producto);
    if (ps.length < 2) return;
    upd(l.key, { presentacion: ps[(ps.indexOf(l.presentacion) + 1) % ps.length] });
  };

  async function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    const l = carrito[fila];
    if (resultados.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, resultados.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); return; }
    } else if (!q && l) {
      // Con la búsqueda vacía, el teclado opera sobre la fila seleccionada del carrito.
      if (e.key === "ArrowDown") { e.preventDefault(); setFila((f) => Math.min(f + 1, carrito.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setFila((f) => Math.max(f - 1, 0)); return; }
      if (e.key === "+") { e.preventDefault(); upd(l.key, { cantidad: l.cantidad + 1 }); return; }
      if (e.key === "-") { e.preventDefault(); upd(l.key, { cantidad: Math.max(1, l.cantidad - 1) }); return; }
      if (e.key === "Delete") { e.preventDefault(); quitar(l.key); return; }
    }
    if (e.key === "Enter" && !e.ctrlKey) {
      e.preventDefault();
      const term = q.trim();
      // Lector USB con el cursor en el buscador: el código llega como texto + Enter.
      if (/^\d{6,14}$/.test(term) && await agregarPorCodigo(term, e.shiftKey ? "empaque" : "unidad")) return;
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

  function limpiarVenta() {
    setCarrito([]); setCliente(CLIENTE_VACIO); setReceta(RECETA_VACIA); setTipo("03"); setEstadoDoc(""); setFila(0);
    setTimeout(() => searchRef.current?.focus(), 30);
  }

  async function enviarWhatsApp(u: Ultima) {
    const tel = window.prompt("Celular del cliente (9 dígitos)", leer("pos:ultimo-cel", ""))?.replace(/\D/g, "");
    if (!tel) return;
    if (!/^9\d{8}$/.test(tel)) { toast.error("Ingrese un celular peruano de 9 dígitos que empiece con 9."); return; }
    const { data: v } = await sb.from("ventas").select("sunat_pdf_url, venta_items(descripcion,cantidad,total)").eq("id", u.venta_id).single();
    const lineas = ((v as any)?.venta_items ?? []).map((i: any) => `• ${Number(i.cantidad)} ${i.descripcion}: ${S(i.total)}`).join("\n");
    const texto = `*${empresa.nombre_comercial || empresa.razon_social || "Botica"}*\nComprobante ${u.comprobante}\n${lineas}\n*Total: ${S(u.total)}*` +
      ((v as any)?.sunat_pdf_url ? `\n\nDescargue su comprobante electrónico: ${(v as any).sunat_pdf_url}` : "") + "\n\n¡Gracias por su compra!";
    window.open(`https://wa.me/51${tel}?text=${encodeURIComponent(texto)}`, "_blank");
  }

  const imprimir = (id: number) => window.open(`/ventas/${id}/ticket`, "ticket", "width=420,height=700");

  // Atajos globales
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (cobrando || fichaDe || camara || alternativasDe) return;
      const l = carrito[fila];
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      else if (e.key === "F4") { e.preventDefault(); document.getElementById("cli-doc")?.focus(); }
      else if (e.key === "F6") { e.preventDefault(); const p = resultados[sel] ?? l?.producto; if (p) setFichaDe(p); }
      else if (e.key === "F8") { e.preventDefault(); if (l) alternarPresentacion(l); }
      else if (e.key === "F7") { e.preventDefault(); const p = resultados[sel] ?? l?.producto; if (p) setAlternativasDe(p); }
      else if (e.key === "F9" || (e.key === "Enter" && e.ctrlKey)) { e.preventDefault(); abrirCobro(); }
      else if (e.key === "F10" && ultima) { e.preventDefault(); imprimir(ultima.venta_id); }
      else if (!enCampoTexto(document.activeElement) && l) {
        if (e.key === "Delete") { e.preventDefault(); quitar(l.key); }
        else if (e.key === "+") { e.preventDefault(); upd(l.key, { cantidad: l.cantidad + 1 }); }
        else if (e.key === "-") { e.preventDefault(); upd(l.key, { cantidad: Math.max(1, l.cantidad - 1) }); }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  async function buscarCliente() {
    const num = cliente.numero_documento;
    if (!num) { setEstadoDoc(""); return; }
    const tipoDoc = num.length === 11 ? "6" : cliente.tipo_documento;
    setEstadoDoc("buscando");
    const { data } = await sb.from("clientes").select("*").eq("numero_documento", num).limit(1);
    if (data?.[0]) {
      setCliente({ tipo_documento: data[0].tipo_documento, numero_documento: data[0].numero_documento, nombre: data[0].nombre, direccion: data[0].direccion ?? "" });
      setEstadoDoc("ok"); return;
    }
    setCliente((c) => ({ ...c, tipo_documento: tipoDoc }));
    if (/^\d{8}$|^\d{11}$/.test(num)) {
      const r = await fetch(`/api/consulta-documento?numero=${num}`).catch(() => null);
      if (r?.ok) {
        const d = await r.json();
        setCliente((c) => c.numero_documento === num ? { ...c, tipo_documento: d.tipo_documento, nombre: d.nombre ?? c.nombre, direccion: d.direccion ?? c.direccion } : c);
        if (d.estado && d.estado !== "ACTIVO") toast.error(`RUC en estado ${d.estado}${d.condicion ? ` / ${d.condicion}` : ""}`);
        setEstadoDoc("ok"); return;
      }
    }
    setEstadoDoc("nuevo");
  }

  const filaSel = carrito[fila];

  return (
    <div className="-mx-4 -my-4 lg:-mx-6 lg:-my-5 flex min-h-screen flex-col lg:h-screen lg:flex-row">
      {/* Columna principal */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        {!turno && (
          <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
            <span>No hay turno de caja abierto. Puede armar la venta, pero no cobrar.</span>
            <Link href="/caja" className="btn-secondary btn-sm">Abrir turno</Link>
          </div>
        )}

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input id="pos-buscar" ref={searchRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey}
              placeholder="Producto, principio activo o código de barras"
              className="input h-10 rounded-lg pl-9 pr-24 text-[14px] shadow-[0_1px_2px_rgba(0,0,0,.04)]" autoComplete="off" />
            <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-zinc-400">
              {buscando ? <Spinner /> : <ScanBarcode className="size-4" />}<span className="kbd">F2</span>
            </div>
            {resultados.length > 0 && (
              <div className="absolute inset-x-0 top-full z-30 mt-1 flex max-h-[62vh] overflow-hidden rounded-lg border border-zinc-200 bg-white pb-7 shadow-lg">
                <div className="min-w-0 flex-1 overflow-y-auto">
                  {resultados.map((p, i) => {
                    const sinStock = (p.stock_vendible ?? 0) <= 0;
                    return (
                      <div key={p.id} onMouseEnter={() => setSel(i)} onClick={() => agregar(p, "unidad")}
                        className={clsx("flex cursor-pointer items-center gap-3 border-b border-zinc-100 px-3 py-2", i === sel && "bg-marca-50/70", sinStock && "opacity-50")}>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-zinc-900">
                            {p.nombre} {p.concentracion}
                            {p.condicion_venta !== "libre" && <span className={CONDICION_BADGE[p.condicion_venta]}>{CONDICION_VENTA[p.condicion_venta]}</span>}
                            {p.refrigerado && <Snowflake className="size-3 text-sky-500" />}
                          </p>
                          <p className="truncate text-[11.5px] text-zinc-500">
                            {[p.principio_activo, p.forma_farmaceutica, p.laboratorio].filter(Boolean).join(" · ")}
                            {p.proximo_vencimiento && <> · vence {fecha(p.proximo_vencimiento)}</>}
                          </p>
                        </div>
                        <span className={clsx("w-14 text-right text-[12px] tabular-nums", sinStock ? "text-rose-600" : "text-zinc-500")}>{N(p.stock_vendible)} u.</span>
                        <span className="w-16 text-right text-[13px] font-medium tabular-nums">{S(p.precio_unidad)}</span>
                        <span className="hidden w-40 text-right text-[11.5px] tabular-nums text-zinc-500 sm:block">
                          {presentaciones(p).filter((x) => x !== "unidad").map((x) => `${x === "blister" ? "Bl" : "Cj"} x${factorDe(p, x)} ${S(precioPres(p, x))}`).join(" · ")}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="hidden w-80 shrink-0 overflow-y-auto border-l border-zinc-100 bg-zinc-50/70 p-3 md:block">
                  <p className="label">Orientación</p>
                  <FichasProducto productoId={resultados[sel]?.id} compacta />
                </div>
                <div className="absolute inset-x-0 bottom-0 flex h-7 items-center gap-3 border-t border-zinc-100 bg-white px-3 text-[11px] text-zinc-500">
                  <span><span className="kbd">↑↓</span> elegir</span><span><span className="kbd">Enter</span> unidad</span>
                  <span><span className="kbd">Shift</span>+<span className="kbd">Enter</span> caja</span><span><span className="kbd">F6</span> ficha</span><span><span className="kbd">F7</span> genéricos</span>
                  <span className="ml-auto">{resultados.length} resultados</span>
                </div>
              </div>
            )}
          </div>
          <button onClick={() => setCamara(true)} className="btn-secondary h-10 rounded-lg px-3" title="Leer código con la cámara"><Camera className="size-4" /></button>
        </div>

        <div className="card flex min-h-[280px] flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {carrito.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center">
                <div className="grid size-12 place-items-center rounded-full bg-marca-50 text-marca-600"><ScanBarcode className="size-6" strokeWidth={1.5} /></div>
                <p className="text-[13px] font-medium text-zinc-700">Listo para vender</p>
                <p className="max-w-xs text-[12px] text-zinc-500">Pase el lector de códigos, use la cámara o escriba el nombre del producto.</p>
                {ultima && <p className="mt-1 text-[11.5px] text-zinc-400">Última venta: {ultima.comprobante} · {S(ultima.total)}</p>}
              </div>
            ) : (
              <table className="tbl">
                <thead><tr><th className="w-7">#</th><th>Producto</th><th className="w-48">Presentación</th><th className="w-28 text-center">Cant.</th>
                  <th className="num w-20">P. unit.</th><th className="num w-20">Desc.</th><th className="num w-24">Importe</th><th className="w-8" /></tr></thead>
                <tbody>
                  {carrito.map((l, i) => {
                    const exceso = unidadesDe(l) > (l.producto.stock_vendible ?? 0);
                    const activa = i === fila;
                    return (
                      <tr key={l.key} onClick={() => setFila(i)} className={clsx("cursor-default", activa && "[&>td]:!bg-marca-50/60 [&>td:first-child]:shadow-[inset_2px_0_0_var(--color-marca-600)]")}>
                        <td className="text-zinc-400 tabular-nums">{i + 1}</td>
                        <td>
                          <p className="font-medium text-zinc-900">{l.producto.nombre} {l.producto.concentracion}</p>
                          <p className="text-[11.5px] text-zinc-500">
                            {l.producto.laboratorio}
                            {l.producto.condicion_venta !== "libre" && <span className={`${CONDICION_BADGE[l.producto.condicion_venta]} ml-1.5`}>{CONDICION_VENTA[l.producto.condicion_venta]}</span>}
                            {exceso && <span className="badge-red ml-1.5">Stock {l.producto.stock_vendible} u.</span>}
                          </p>
                        </td>
                        <td>
                          {presentaciones(l.producto).length > 1 ? (
                            <div className="seg">
                              {presentaciones(l.producto).map((pr) => (
                                <button key={pr} data-on={l.presentacion === pr} onClick={() => upd(l.key, { presentacion: pr })} className="!h-6 !px-2 whitespace-nowrap text-[11.5px]">
                                  {etiquetaPres(l.producto, pr)}
                                </button>
                              ))}
                            </div>
                          ) : <span className="text-[11.5px] text-zinc-500">Unidad</span>}
                        </td>
                        <td>
                          <div className="flex items-center justify-center">
                            <button tabIndex={-1} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" onClick={() => upd(l.key, { cantidad: Math.max(1, l.cantidad - 1) })}><Minus className="size-3.5" /></button>
                            <input className="input h-7 w-11 px-1 text-center tabular-nums" inputMode="numeric" value={l.cantidad} onFocus={(e) => { setFila(i); e.target.select(); }}
                              onChange={(e) => upd(l.key, { cantidad: Math.max(1, parseInt(e.target.value.replace(/\D/g, "")) || 1) })}
                              onKeyDown={(e) => e.key === "Enter" && searchRef.current?.focus()} />
                            <button tabIndex={-1} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" onClick={() => upd(l.key, { cantidad: l.cantidad + 1 })}><Plus className="size-3.5" /></button>
                          </div>
                        </td>
                        <td className="num text-zinc-600">{S(precioDe(l))}</td>
                        <td className="num">
                          <input className="input h-7 w-16 px-1.5 text-right tabular-nums" inputMode="decimal" value={l.descuento || ""} placeholder="0.00" onFocus={() => setFila(i)}
                            onChange={(e) => upd(l.key, { descuento: Math.max(0, parseFloat(e.target.value) || 0) })}
                            onKeyDown={(e) => e.key === "Enter" && searchRef.current?.focus()} />
                        </td>
                        <td className="num font-semibold text-zinc-900">{S(totalLinea(l))}</td>
                        <td><button tabIndex={-1} onClick={() => quitar(l.key)} className="rounded p-1 text-zinc-300 hover:bg-rose-50 hover:text-rose-600"><X className="size-3.5" /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-100 bg-zinc-50/50 px-3 py-1.5 text-[11px] text-zinc-500">
            <span><span className="kbd">↑↓</span> fila</span><span><span className="kbd">+</span> <span className="kbd">−</span> cantidad</span>
            <span><span className="kbd">F8</span> unid./blíster/caja</span><span><span className="kbd">Supr</span> quitar</span><span><span className="kbd">F6</span> ficha</span><span><span className="kbd">F7</span> genéricos</span>
            <span className={clsx("flex items-center gap-1", celulares ? "text-emerald-700" : "")} title="Abra /escaner en el celular con su mismo usuario">
              <Smartphone className="size-3" />{celulares ? "Celular lector conectado" : <Link href="/escaner" target="_blank" className="hover:underline">Usar celular como lector</Link>}
            </span>
            {carrito.length > 0 && <>
              <span className="ml-auto tabular-nums">{carrito.length} ítems · {N(carrito.reduce((a, l) => a + unidadesDe(l), 0))} u.</span>
              <button onClick={limpiarVenta} className="text-rose-600 hover:underline">Vaciar</button>
            </>}
          </div>
        </div>

        {requiereReceta && (
          <div className="card p-3">
            <p className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-zinc-900">
              Receta médica
              {carrito.some((l) => ["receta_retenida", "controlado"].includes(l.producto.condicion_venta)) && <span className="badge-violet">Se retiene</span>}
              {hayControlado && <span className="badge-red">Dispensa Q.F.</span>}
            </p>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-8">
              <Field label="Paciente *" className="md:col-span-2"><input className="input" value={receta.paciente_nombre} onChange={(e) => setReceta({ ...receta, paciente_nombre: e.target.value })} /></Field>
              <Field label="DNI paciente"><input className="input" value={receta.paciente_documento} onChange={(e) => setReceta({ ...receta, paciente_documento: e.target.value })} /></Field>
              <Field label="Médico *" className="md:col-span-2"><input className="input" value={receta.medico_nombre} onChange={(e) => setReceta({ ...receta, medico_nombre: e.target.value })} /></Field>
              <Field label="CMP/COP *"><input className="input" value={receta.medico_cmp} onChange={(e) => setReceta({ ...receta, medico_cmp: e.target.value })} /></Field>
              <Field label="N° receta"><input className="input" value={receta.numero} onChange={(e) => setReceta({ ...receta, numero: e.target.value })} /></Field>
              <Field label="Fecha"><input type="date" className="input" value={receta.fecha_receta} onChange={(e) => setReceta({ ...receta, fecha_receta: e.target.value })} /></Field>
            </div>
          </div>
        )}
      </div>

      {/* Panel derecho */}
      <aside className="flex w-full shrink-0 flex-col border-t border-zinc-200 bg-white lg:w-[330px] lg:border-l lg:border-t-0">
        {ultima && (
          <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2.5">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-800"><Check className="size-3.5" />{ultima.comprobante} · {S(ultima.total)}</p>
              <button onClick={() => setUltima(null)} className="text-emerald-700/60 hover:text-emerald-900"><X className="size-3.5" /></button>
            </div>
            {ultima.vuelto > 0 && <p className="mt-0.5 flex items-baseline justify-between text-[12px] text-emerald-800">Vuelto <span className="text-[24px] font-semibold tabular-nums">{S(ultima.vuelto)}</span></p>}
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <button onClick={() => enviarWhatsApp(ultima)} className="btn-secondary btn-sm" title="Enviar el comprobante por WhatsApp"><MessageCircle className="size-3.5" />WhatsApp</button>
              <button onClick={() => imprimir(ultima.venta_id)} className="btn-secondary btn-sm"><Printer className="size-3.5" />Ticket <span className="text-zinc-400">F10</span></button>
            </div>
          </div>
        )}

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="seg grid w-full grid-cols-3">
            {([["03", "Boleta"], ["01", "Factura"], ["NV", "Nota venta"]] as const).map(([v, l]) => (
              <button key={v} data-on={tipo === v} onClick={() => { setTipo(v); if (v === "01") setCliente((c) => ({ ...c, tipo_documento: "6" })); }}>{l}</button>
            ))}
          </div>

          <div className="space-y-2">
            <p className="label mb-0 flex items-center justify-between">Cliente <span className="kbd">F4</span></p>
            <div className="flex gap-1.5">
              <select className="input w-[88px]" value={cliente.tipo_documento} onChange={(e) => setCliente({ ...cliente, tipo_documento: e.target.value })} disabled={tipo === "01"}>
                <option value="1">DNI</option><option value="6">RUC</option><option value="4">C.E.</option><option value="7">Pasap.</option>
              </select>
              <div className="relative flex-1">
                <input id="cli-doc" className="input pr-7 tabular-nums" placeholder={tipo === "01" ? "RUC" : "DNI / RUC (opcional)"} value={cliente.numero_documento} inputMode="numeric"
                  onChange={(e) => { setCliente({ ...cliente, numero_documento: e.target.value.trim() }); setEstadoDoc(""); }} onBlur={buscarCliente}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscarCliente(); } }} />
                <span className="absolute right-2 top-1/2 -translate-y-1/2">{estadoDoc === "buscando" ? <Spinner className="size-3.5 text-zinc-400" /> : estadoDoc === "ok" ? <Check className="size-3.5 text-emerald-600" /> : null}</span>
              </div>
            </div>
            {(cliente.numero_documento || tipo === "01") && (
              <>
                <input className="input" placeholder={tipo === "01" ? "Razón social" : "Nombre completo"} value={cliente.nombre} onChange={(e) => setCliente({ ...cliente, nombre: e.target.value })} />
                <input className="input" placeholder={tipo === "01" ? "Dirección fiscal" : "Dirección (opcional)"} value={cliente.direccion} onChange={(e) => setCliente({ ...cliente, direccion: e.target.value })} />
              </>
            )}
            {estadoDoc === "nuevo" && <p className="text-[11.5px] text-zinc-500">Cliente nuevo: complete el nombre. Se guardará con la venta.</p>}
            {!cliente.numero_documento && tipo !== "01" && <p className="text-[11.5px] text-zinc-400">Clientes varios (boletas hasta {S(limiteDni)}).</p>}
          </div>

          {filaSel && (
            <div className="rounded-lg border border-zinc-100 bg-zinc-50/60 p-3">
              <p className="label flex items-center justify-between">
                <span className="flex items-center gap-1 truncate"><BookOpen className="size-3" />Orientación · {filaSel.producto.nombre}</span>
                <button className="kbd hover:text-zinc-800" onClick={() => setFichaDe(filaSel.producto)}>F6</button>
              </p>
              <FichasProducto productoId={filaSel.producto.id} compacta />
            </div>
          )}
        </div>

        <div className="border-t border-zinc-200 p-4">
          <dl className="space-y-0.5 text-[12px] text-zinc-500">
            {totales.desc > 0 && <div className="flex justify-between"><dt>Descuentos</dt><dd className="tabular-nums">−{S(totales.desc)}</dd></div>}
            <div className="flex justify-between"><dt>Op. gravada</dt><dd className="tabular-nums">{S(totales.grav)}</dd></div>
            {totales.exo > 0 && <div className="flex justify-between"><dt>Op. exonerada</dt><dd className="tabular-nums">{S(totales.exo)}</dd></div>}
            {totales.ina > 0 && <div className="flex justify-between"><dt>Op. inafecta</dt><dd className="tabular-nums">{S(totales.ina)}</dd></div>}
            <div className="flex justify-between"><dt>IGV {igvPct}%</dt><dd className="tabular-nums">{S(totales.igv)}</dd></div>
          </dl>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-[12.5px] text-zinc-600">Total</span>
            <span className="text-[30px] font-semibold tabular-nums tracking-tight text-zinc-900">{S(totales.total)}</span>
          </div>
          <button onClick={abrirCobro} disabled={!carrito.length || !turno} className="btn-accent mt-2 h-11 w-full rounded-lg text-[14px] shadow-sm">
            Cobrar <span className="text-[11px] font-normal text-white/70">F9</span>
          </button>
          <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[11.5px] text-zinc-500">
            <input type="checkbox" className="accent-marca-600" checked={autoImprimir} onChange={(e) => { setAutoImprimir(e.target.checked); guardar("pos:auto-imprimir", e.target.checked ? "1" : "0"); }} />
            Imprimir ticket al cobrar
          </label>
        </div>
      </aside>

      {cobrando && (
        <ModalCobro total={totales.total} onClose={() => { setCobrando(false); searchRef.current?.focus(); }}
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
            setUltima({ ...data, vuelto: r2(vuelto) });
            try { localStorage.removeItem("pos:carrito"); } catch {}
            limpiarVenta();
            if (autoImprimir) imprimir(data.venta_id);
            // Envío a SUNAT en segundo plano: no bloquea la atención
            if (tipo !== "NV") fetch("/api/sunat/enviar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ venta_id: data.venta_id }) }).catch(() => {});
            return true;
          }} />
      )}

      {camara && <ModalCamara onCodigo={(c) => agregarPorCodigo(c)} onClose={() => { setCamara(false); searchRef.current?.focus(); }} />}
      {alternativasDe && (
        <ModalAlternativas producto={alternativasDe} onClose={() => { setAlternativasDe(null); searchRef.current?.focus(); }}
          onElegir={(p) => {
            const l = carrito[fila];
            if (l && l.producto.id === alternativasDe.id) quitar(l.key);
            agregar(p); setAlternativasDe(null);
          }} />
      )}
      <ModalFicha producto={fichaDe} onClose={() => { setFichaDe(null); searchRef.current?.focus(); }} />
    </div>
  );
}

const METODOS = [
  { v: "efectivo", l: "Efectivo", k: "e" }, { v: "tarjeta_debito", l: "Débito", k: "d" }, { v: "tarjeta_credito", l: "Crédito", k: "c" },
  { v: "yape", l: "Yape", k: "y" }, { v: "plin", l: "Plin", k: "p" }, { v: "transferencia", l: "Transferencia", k: "t" },
];

function ModalCobro({ total, onClose, onConfirm }: { total: number; onClose: () => void; onConfirm: (p: Pago[]) => Promise<boolean> }) {
  const posDefault = leer("pos:proveedor", "izipay");
  const [pagos, setPagos] = useState<Pago[]>([{ metodo: "efectivo", monto: total, recibido: undefined }]);
  const [enviando, setEnviando] = useState(false);
  const pagado = r2(pagos.reduce((a, p) => a + (p.monto || 0), 0));
  const falta = r2(total - pagado);
  const efectivo = pagos.find((p) => p.metodo === "efectivo");
  const vuelto = efectivo?.recibido ? r2(Math.max(0, efectivo.recibido - efectivo.monto)) : 0;

  function setMetodo(metodo: string) {
    if (pagos.length === 1) setPagos([{ metodo, monto: total, pos_proveedor: metodo.startsWith("tarjeta") ? posDefault : undefined }]);
  }
  const upd = (i: number, patch: Partial<Pago>) => setPagos((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function confirmar() {
    if (enviando) return;
    if (falta !== 0) { toast.error(falta > 0 ? `Falta asignar ${S(falta)}` : `Los pagos exceden el total en ${S(-falta)}`); return; }
    for (const p of pagos) {
      if (p.metodo.startsWith("tarjeta") && !p.numero_operacion?.trim()) { toast.error("Ingrese el N° de operación del voucher del POS."); return; }
      if (p.metodo === "efectivo" && p.recibido !== undefined && p.recibido < p.monto) { toast.error("El efectivo recibido es menor al monto."); return; }
    }
    const t = pagos.find((p) => p.pos_proveedor);
    if (t?.pos_proveedor) guardar("pos:proveedor", t.pos_proveedor);
    setEnviando(true);
    const ok = await onConfirm(pagos.map((p) => ({ ...p, monto: r2(p.monto) })));
    if (!ok) setEnviando(false);
  }

  // Teclas: letra del medio de pago (E, D, C, Y, P, T) y Enter para confirmar.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLInputElement | null;
      if (el?.tagName === "SELECT") return;
      const numerico = !el || el.tagName !== "INPUT" || ["numeric", "decimal"].includes(el.inputMode);
      const m = METODOS.find((x) => x.k === e.key.toLowerCase());
      if (m && numerico && !e.ctrlKey && !e.altKey && pagos.length === 1) { e.preventDefault(); setMetodo(m.v); return; }
      if (e.key === "Enter") { e.preventDefault(); confirmar(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  return (
    <Modal open onClose={onClose} title="Cobrar" size="md"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancelar <span className="text-zinc-400">Esc</span></button>
        <button className="btn-accent min-w-40" onClick={confirmar} disabled={enviando}>
          {enviando && <Spinner />}Confirmar <span className="text-[11px] font-normal text-white/70">Enter</span>
        </button>
      </>}>
      <div className="mb-4 flex items-end justify-between rounded-lg bg-zinc-50 px-4 py-3">
        <div><p className="text-[11.5px] text-zinc-500">Total</p><p className="text-[28px] font-semibold tabular-nums tracking-tight text-zinc-900">{S(total)}</p></div>
        {vuelto > 0 && <div className="text-right"><p className="text-[11.5px] text-zinc-500">Vuelto</p><p className="text-[28px] font-semibold tabular-nums text-emerald-700">{S(vuelto)}</p></div>}
        {falta !== 0 && <div className="text-right"><p className="text-[11.5px] text-rose-600">{falta > 0 ? "Falta" : "Exceso"}</p><p className="text-xl font-semibold tabular-nums text-rose-600">{S(Math.abs(falta))}</p></div>}
      </div>

      {pagos.length === 1 && (
        <div className="seg mb-4 grid w-full grid-cols-3 sm:grid-cols-6">
          {METODOS.map((m) => (
            <button key={m.v} data-on={pagos[0].metodo === m.v} onClick={() => setMetodo(m.v)} className="!h-8 text-[12px]">
              <span className="underline decoration-zinc-400 underline-offset-2">{m.l[0]}</span>{m.l.slice(1)}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {pagos.map((p, i) => (
          <div key={i} className={clsx(pagos.length > 1 && "rounded-md border border-zinc-200 p-3")}>
            <div className="flex items-end gap-2">
              {pagos.length > 1 && (
                <Field label="Medio" className="w-40">
                  <select className="input" value={p.metodo} onChange={(e) => upd(i, { metodo: e.target.value, pos_proveedor: e.target.value.startsWith("tarjeta") ? posDefault : undefined })}>
                    {Object.entries(METODO_PAGO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Monto" className="w-32">
                <input className="input text-right tabular-nums" inputMode="decimal" value={p.monto} onChange={(e) => upd(i, { monto: parseFloat(e.target.value) || 0 })} />
              </Field>
              {p.metodo === "efectivo" && (
                <Field label="Recibido" className="flex-1">
                  <input className="input text-right text-[15px] tabular-nums" inputMode="decimal" autoFocus placeholder="Monto entregado" value={p.recibido ?? ""}
                    onChange={(e) => upd(i, { recibido: e.target.value ? parseFloat(e.target.value) : undefined })} />
                </Field>
              )}
              {pagos.length > 1 && <button className="btn-ghost px-2 text-rose-600" onClick={() => setPagos(pagos.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>}
            </div>
            {p.metodo === "efectivo" && (
              <div className="mt-2 flex gap-1.5">
                {[p.monto, 10, 20, 50, 100, 200].filter((v, k, a) => v >= p.monto && a.indexOf(v) === k).map((v) => (
                  <button key={v} onClick={() => upd(i, { recibido: v })} className="btn-secondary btn-sm tabular-nums">{v === p.monto ? "Exacto" : `S/ ${v}`}</button>
                ))}
              </div>
            )}
            {p.metodo.startsWith("tarjeta") && (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Field label="POS">
                  <select className="input" value={p.pos_proveedor} onChange={(e) => upd(i, { pos_proveedor: e.target.value })}>
                    {POS_PROVEEDORES.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
                  </select>
                </Field>
                <Field label="N° operación *"><input className="input tabular-nums" inputMode="numeric" autoFocus value={p.numero_operacion ?? ""} onChange={(e) => upd(i, { numero_operacion: e.target.value })} /></Field>
                <Field label="Marca">
                  <select className="input" value={p.marca_tarjeta ?? ""} onChange={(e) => upd(i, { marca_tarjeta: e.target.value })}>
                    <option value="">—</option><option>Visa</option><option>Mastercard</option><option>American Express</option><option>Diners</option>
                  </select>
                </Field>
                <Field label="Últimos 4"><input className="input tabular-nums" maxLength={4} inputMode="numeric" value={p.ultimos4 ?? ""} onChange={(e) => upd(i, { ultimos4: e.target.value.replace(/\D/g, "") })} /></Field>
              </div>
            )}
            {["yape", "plin", "transferencia"].includes(p.metodo) && (
              <div className="mt-2 w-48"><Field label="N° operación (opcional)"><input className="input tabular-nums" inputMode="numeric" autoFocus value={p.numero_operacion ?? ""} onChange={(e) => upd(i, { numero_operacion: e.target.value })} /></Field></div>
            )}
          </div>
        ))}
        <div className="flex gap-3 text-[12px]">
          {falta > 0 && <button className="text-zinc-600 underline-offset-2 hover:underline" onClick={() => setPagos([...pagos, { metodo: "tarjeta_debito", monto: falta, pos_proveedor: posDefault }])}><Plus className="mr-0.5 inline size-3" />Agregar medio ({S(falta)})</button>}
          {pagos.length === 1 && (
            <button className="text-zinc-600 underline-offset-2 hover:underline" onClick={() => setPagos([{ metodo: "efectivo", monto: r2(total / 2) }, { metodo: "tarjeta_debito", monto: r2(total - r2(total / 2)), pos_proveedor: posDefault }])}>
              Pago mixto
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Genéricos y alternativas: mismo principio activo, ordenados por precio. Ayuda a ofrecer la opción más económica. */
function ModalAlternativas({ producto, onClose, onElegir }: { producto: Producto; onClose: () => void; onElegir: (p: Producto) => void }) {
  const [rows, setRows] = useState<Producto[] | null>(null);
  const [sel, setSel] = useState(0);
  const [mismaConc, setMismaConc] = useState(true);
  useEffect(() => {
    const pa = producto.principio_activo?.trim();
    if (!pa) { setRows([]); return; }
    let q = supabaseBrowser().from("v_productos").select("*").eq("activo", true).ilike("principio_activo", pa).neq("id", producto.id);
    if (mismaConc && producto.concentracion) q = q.eq("concentracion", producto.concentracion);
    q.order("precio_unidad").limit(30).then(({ data }: any) => { setRows((data ?? []).sort((a: Producto, b: Producto) => Number((b.stock_vendible ?? 0) > 0) - Number((a.stock_vendible ?? 0) > 0))); setSel(0); });
  }, [producto, mismaConc]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!rows?.length) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, rows.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
      else if (e.key === "Enter") { e.preventDefault(); onElegir(rows[sel]); }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  });
  const base = Number(producto.precio_unidad);
  return (
    <Modal open onClose={onClose} title={`Alternativas a ${producto.nombre} ${producto.concentracion ?? ""}`} size="lg">
      <div className="mb-3 flex items-center justify-between text-[12px] text-zinc-500">
        <span>Principio activo: <b className="text-zinc-800">{producto.principio_activo || "—"}</b> · precio actual {S(base)} por unidad</span>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={mismaConc} onChange={(e) => setMismaConc(e.target.checked)} />Misma concentración</label>
      </div>
      {rows === null ? <div className="py-6 text-center"><Spinner /></div> : !rows.length ? (
        <p className="py-6 text-center text-[12.5px] text-zinc-400">{producto.principio_activo ? "No hay otros productos con este principio activo." : "Registre el principio activo del producto para ver alternativas."}</p>
      ) : (
        <table className="tbl">
          <thead><tr><th>Producto</th><th>Laboratorio</th><th className="num">Stock</th><th className="num">Precio unid.</th><th className="num">Diferencia</th></tr></thead>
          <tbody>
            {rows.map((p, i) => {
              const dif = Number(p.precio_unidad) - base;
              const sinStock = (p.stock_vendible ?? 0) <= 0;
              return (
                <tr key={p.id} onMouseEnter={() => setSel(i)} onClick={() => !sinStock && onElegir(p)} className={clsx("cursor-pointer", i === sel && "[&>td]:!bg-marca-50/70", sinStock && "opacity-50")}>
                  <td><p className="font-medium">{p.nombre} {p.concentracion}</p><p className="text-[11.5px] text-zinc-500">{p.forma_farmaceutica}{p.registro_sanitario?.startsWith("EG") ? " · Genérico" : ""}</p></td>
                  <td className="text-zinc-500">{p.laboratorio}</td>
                  <td className={clsx("num", sinStock && "text-rose-600")}>{N(p.stock_vendible)}</td>
                  <td className="num font-medium">{S(p.precio_unidad)}</td>
                  <td className={clsx("num", dif < 0 ? "text-emerald-700" : dif > 0 ? "text-zinc-500" : "")}>{dif === 0 ? "=" : `${dif < 0 ? "−" : "+"}${S(Math.abs(dif))}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-[11.5px] text-zinc-400"><span className="kbd">↑↓</span> elegir · <span className="kbd">Enter</span> reemplaza el producto seleccionado del carrito. Los genéricos (registro EG) suelen ser la opción más económica.</p>
    </Modal>
  );
}
