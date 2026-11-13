"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  LayoutDashboard, ShoppingCart, Receipt, Wallet, Pill, Boxes, ScrollText, Truck, Building2, ShieldCheck,
  FileCheck2, BarChart3, UserCog, Settings, LogOut, WifiOff, Contact, BookOpen, ClipboardCheck, PanelLeftClose, PanelLeftOpen, BookMarked,
} from "lucide-react";
import { useApp } from "./app-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ROLES, S } from "@/lib/format";
import type { Rol } from "@/lib/types";

type Item = { href: string; label: string; icon: any; roles?: Rol[]; atajo?: string };
const NAV: { grupo: string; items: Item[] }[] = [
  { grupo: "Operación", items: [
    { href: "/", label: "Tablero", icon: LayoutDashboard },
    { href: "/pos", label: "Punto de venta", icon: ShoppingCart, roles: ["admin", "quimico", "cajero"], atajo: "F1" },
    { href: "/vademecum", label: "Vademécum", icon: BookOpen, atajo: "F6" },
    { href: "/caja", label: "Caja y turnos", icon: Wallet, roles: ["admin", "quimico", "cajero"] },
    { href: "/ventas", label: "Ventas", icon: Receipt },
    { href: "/clientes", label: "Clientes", icon: Contact },
  ]},
  { grupo: "Inventario", items: [
    { href: "/productos", label: "Productos", icon: Pill },
    { href: "/inventario", label: "Lotes", icon: Boxes },
    { href: "/kardex", label: "Kardex", icon: ScrollText },
    { href: "/conteo", label: "Inventario físico", icon: ClipboardCheck, roles: ["admin", "quimico", "almacen"] },
    { href: "/compras", label: "Compras", icon: Truck, roles: ["admin", "quimico", "almacen"] },
    { href: "/proveedores", label: "Proveedores", icon: Building2, roles: ["admin", "quimico", "almacen"] },
  ]},
  { grupo: "Cumplimiento", items: [
    { href: "/sunat", label: "SUNAT", icon: FileCheck2, roles: ["admin", "quimico", "cajero"] },
    { href: "/digemid", label: "DIGEMID", icon: ShieldCheck },
    { href: "/reclamaciones", label: "Reclamaciones", icon: BookMarked },
  ]},
  { grupo: "Administración", items: [
    { href: "/reportes", label: "Reportes", icon: BarChart3, roles: ["admin", "quimico"] },
    { href: "/usuarios", label: "Usuarios", icon: UserCog, roles: ["admin"] },
    { href: "/configuracion", label: "Configuración", icon: Settings, roles: ["admin"] },
  ]},
];

export function Shell({ children }: { children: ReactNode }) {
  const { perfil, empresa, turno } = useApp();
  const path = usePathname();
  const router = useRouter();
  const [online, setOnline] = useState(true);
  const [mini, setMini] = useState(false);
  const [angosto, setAngosto] = useState(false);

  useEffect(() => {
    try { setMini(localStorage.getItem("nav-mini") === "1"); } catch {}
    const mq = window.matchMedia("(max-width: 1023px)");
    const enMq = () => setAngosto(mq.matches); enMq(); mq.addEventListener("change", enMq);
    const up = () => setOnline(true), down = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    const key = (e: KeyboardEvent) => { if (e.key === "F1") { e.preventDefault(); router.push("/pos"); } };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); window.removeEventListener("keydown", key); mq.removeEventListener("change", enMq); };
  }, [router]);

  // En el punto de venta el menú se pliega solo para ganar espacio.
  const plegado = mini || angosto || path.startsWith("/pos");
  function alternar() { const v = !mini; setMini(v); try { localStorage.setItem("nav-mini", v ? "1" : "0"); } catch {} }

  async function salir() {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className={clsx("no-print flex shrink-0 flex-col border-r border-zinc-200 bg-white transition-[width] duration-150", plegado ? "w-[52px]" : "w-52")}>
        <div className={clsx("flex h-12 items-center border-b border-zinc-100", plegado ? "justify-center" : "gap-2 px-3")}>
          <div className="grid size-7 shrink-0 place-items-center rounded-md bg-marca-600 text-[11px] font-bold text-white">VP</div>
          {!plegado && (
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[12.5px] font-semibold text-zinc-900">{empresa.nombre_comercial || "Vega Pharma Plus"}</p>
              <p className="truncate text-[10.5px] text-zinc-400">RUC {empresa.ruc}</p>
            </div>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-2">
          {NAV.map((g, gi) => {
            const items = g.items.filter((i) => !i.roles || i.roles.includes(perfil.rol));
            if (!items.length) return null;
            return (
              <div key={g.grupo} className={clsx(gi > 0 && "mt-3")}>
                {!plegado ? <p className="px-2 pb-1 text-[10.5px] font-medium text-zinc-400">{g.grupo}</p> : gi > 0 && <div className="mx-2 mb-2 border-t border-zinc-100" />}
                {items.map((i) => {
                  const activo = i.href === "/" ? path === "/" : path.startsWith(i.href);
                  return (
                    <Link key={i.href} href={i.href} title={plegado ? i.label : undefined}
                      className={clsx("flex h-8 items-center gap-2 rounded-md text-[12.5px]",
                        plegado ? "justify-center" : "px-2",
                        activo ? "bg-marca-50 font-medium text-marca-800" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900")}>
                      <i.icon className={clsx("size-[15px] shrink-0", activo ? "text-marca-600" : "text-zinc-400")} strokeWidth={1.75} />
                      {!plegado && <span className="flex-1 truncate">{i.label}</span>}
                      {!plegado && i.atajo && <span className="text-[10px] text-zinc-400">{i.atajo}</span>}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="border-t border-zinc-100 p-2 text-[11.5px]">
          <Link href="/caja" title={turno ? "Turno abierto" : "Sin turno"}
            className={clsx("mb-1 flex h-7 items-center gap-2 rounded-md hover:bg-zinc-50", plegado ? "justify-center" : "px-2")}>
            <span className={clsx("size-2 shrink-0 rounded-full", turno ? "bg-emerald-500" : "bg-amber-400")} />
            {!plegado && <span className="truncate text-zinc-600">{turno ? <>Turno abierto · {S(turno.monto_apertura)}</> : "Sin turno de caja"}</span>}
          </Link>
          <div className={clsx("flex items-center", plegado ? "flex-col gap-1" : "gap-1 px-1")}>
            {!plegado && (
              <div className="min-w-0 flex-1 px-1">
                <p className="truncate font-medium text-zinc-800">{perfil.nombre}</p>
                <p className="truncate text-[10.5px] text-zinc-400">{ROLES[perfil.rol]}</p>
              </div>
            )}
            <button onClick={alternar} title={plegado ? "Expandir menú" : "Plegar menú"} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
              {plegado ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
            <button onClick={salir} title="Cerrar sesión" className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {!online && (
          <div className="no-print flex items-center justify-center gap-2 bg-rose-600 px-5 py-1.5 text-[12.5px] font-medium text-white">
            <WifiOff className="size-3.5" /> Sin conexión. El carrito se conserva; podrá cobrar cuando vuelva internet.
          </div>
        )}
        <main className="flex-1 overflow-y-auto px-4 py-4 lg:px-6 lg:py-5">{children}</main>
      </div>
    </div>
  );
}
