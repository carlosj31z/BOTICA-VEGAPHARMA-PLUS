"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Spinner } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(params.get("inactivo") ? "Su usuario está inactivo o no tiene perfil asignado." : "");
  const [cargando, setCargando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true); setError("");
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
    setCargando(false);
    if (error) { setError(error.message === "Invalid login credentials" ? "Correo o contraseña incorrectos." : error.message); return; }
    router.replace("/"); router.refresh();
  }

  return (
    <form onSubmit={entrar} className="w-full max-w-sm">
      <h1 className="text-[18px] font-semibold tracking-tight text-zinc-900">Iniciar sesión</h1>
      <p className="mt-1 text-[13px] text-zinc-500">Ingrese con el usuario asignado por el administrador.</p>
      <div className="mt-5 space-y-3">
        <div>
          <label className="label">Correo</label>
          <input className="input h-10" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label">Contraseña</label>
          <input className="input h-10" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
        <button className="btn-accent btn-lg w-full" disabled={cargando}>{cargando && <Spinner />}Ingresar</button>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-6">
      <div className="mb-6 flex items-center gap-2.5">
        <div className="grid size-9 place-items-center rounded-lg bg-marca-600 text-[13px] font-bold text-white">VP</div>
        <div className="leading-tight">
          <p className="text-[14px] font-semibold text-zinc-900">Vega Pharma Plus</p>
          <p className="text-[11.5px] text-zinc-500">Sistema de gestión de botica</p>
        </div>
      </div>
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-7 shadow-[0_1px_3px_rgba(0,0,0,.04)]">
        <Suspense><LoginForm /></Suspense>
      </div>
      <p className="mt-6 text-[11.5px] text-zinc-400">Comprobantes SUNAT · Registros DIGEMID · Lotes y vencimientos</p>
    </div>
  );
}
