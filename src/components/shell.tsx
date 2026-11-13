"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  LayoutDashboard, ShoppingCart, Receipt, Wallet, Pill, Boxes, ScrollText, Truck, Building2, ShieldCheck,
  FileCheck2, BarChart3, UserCog, Settings, LogOut, Wifi, WifiOff, Clock, Contact,
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
    { href: "/caja", label: "Caja y turnos", icon: Wallet, roles: ["admin", "quimico", "cajero"] },
    { href: "/ventas", label: "Historial de ventas", icon: Receipt },
    { href: "/clientes", label: "Clientes", icon: Contact },
  ]},
  { grupo: "Inventario", items: [
    { href: "/productos", label: "Productos", icon: Pill },
    { href: "/inventario", label: "Lotes y vencimientos", icon: Boxes },
    { href: "/kardex", label: "Kardex", icon: ScrollText },
    { href: "/compras", label: "Compras", icon: Truck, roles: ["admin", "quimico", "almacen"] },
    { href: "/proveedores", label: "Proveedores", icon: Building2, roles: ["admin", "quimico", "almacen"] },
  ]},
  { grupo: "Cumplimiento", items: [
    { href: "/sunat", label: "Comprobantes SUNAT", icon: FileCheck2, roles: ["admin", "quimico", "cajero"] },
    { href: "/digemid", label: "DIGEMID", icon: ShieldCheck },
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
  const [hora, setHora] = useState("");

  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    const tick = () => setHora(new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" }));
    tick(); const t = setInterval(tick, 30_000);
    const key = (e: KeyboardEvent) => { if (e.key === "F1") { e.preventDefault(); router.push("/pos"); } };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); clearInterval(t); window.removeEventListener("keydown", key); };
  }, [router]);

  async function salir() {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="no-print flex w-60 shrink-0 flex-col bg-marca-900 text-marca-100">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="grid size-9 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15">
            <Pill className="size-5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-white">{empresa.nombre_comercial || "Vega Pharma Plus"}</p>
            <p className="truncate text-[11px] text-marca-200/70">RUC {empresa.ruc}</p>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2.5 pb-4">
          {NAV.map((g) => {
            const items = g.items.filter((i) => !i.roles || i.roles.includes(perfil.rol));
            if (!items.length) return null;
            return (
              <div key={g.grupo} className="mt-3">
                <p className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-marca-200/50">{g.grupo}</p>
                {items.map((i) => {
                  const activo = i.href === "/" ? path === "/" : path.startsWith(i.href);
                  return (
                    <Link key={i.href} href={i.href}
                      className={clsx("flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition",
                        activo ? "bg-white/12 text-white font-medium shadow-[inset_2px_0_0_#34d399]" : "text-marca-100/80 hover:bg-white/6 hover:text-white")}>
                      <i.icon className="size-4 shrink-0 opacity-90" />
                      <span className="flex-1">{i.label}</span>
                      {i.atajo && <span className="text-[10px] text-marca-200/50">{i.atajo}</span>}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-full bg-marca-600 text-xs font-semibold text-white">
              {perfil.nombre.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-medium text-white">{perfil.nombre}</p>
              <p className="truncate text-[11px] text-marca-200/60">{ROLES[perfil.rol]}</p>
            </div>
            <button onClick={salir} title="Cerrar sesión" className="rounded p-1.5 text-marca-200/70 hover:bg-white/10 hover:text-white">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5">
          <div className="flex items-center gap-2 text-[12.5px]">
            {turno ? (
              <Link href="/caja" className="badge-green"><span className="size-1.5 rounded-full bg-emerald-500" />Turno abierto · apertura {S(turno.monto_apertura)}</Link>
            ) : (
              <Link href="/caja" className="badge-amber">Sin turno de caja</Link>
            )}
          </div>
          <div className="flex items-center gap-4 text-[12.5px] text-slate-500">
            <span className="flex items-center gap-1.5"><Clock className="size-3.5" />{hora}</span>
            {online
              ? <span className="flex items-center gap-1.5 text-emerald-600"><Wifi className="size-3.5" />En línea</span>
              : <span className="flex items-center gap-1.5 font-medium text-rose-600"><WifiOff className="size-3.5" />Sin conexión</span>}
          </div>
        </header>
        {!online && (
          <div className="no-print bg-rose-600 px-5 py-1.5 text-center text-[12.5px] font-medium text-white">
            Sin conexión a internet. No cierre esta ventana: el carrito se conserva y podrá cobrar cuando vuelva la conexión.
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-5">{children}</main>
      </div>
    </div>
  );
}
