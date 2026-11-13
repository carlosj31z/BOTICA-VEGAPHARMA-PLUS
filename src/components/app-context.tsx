"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Perfil, Turno } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";

interface Ctx {
  perfil: Perfil;
  empresa: Record<string, any>;
  turno: Turno | null;
  refrescarTurno: () => Promise<void>;
  puede: (...roles: Perfil["rol"][]) => boolean;
}
const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ perfil, empresa, children }: { perfil: Perfil; empresa: Record<string, any>; children: ReactNode }) {
  const [turno, setTurno] = useState<Turno | null>(null);
  const refrescarTurno = useCallback(async () => {
    const { data } = await supabaseBrowser().from("turnos").select("*").eq("usuario_id", perfil.id).eq("estado", "abierto").maybeSingle();
    setTurno(data ?? null);
  }, [perfil.id]);
  useEffect(() => { refrescarTurno(); }, [refrescarTurno]);
  const puede = useCallback((...roles: Perfil["rol"][]) => roles.includes(perfil.rol), [perfil.rol]);
  return <AppCtx.Provider value={{ perfil, empresa, turno, refrescarTurno, puede }}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp fuera de AppProvider");
  return c;
}
