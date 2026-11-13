"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pill, ShieldCheck, FileCheck2, Boxes } from "lucide-react";
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
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Iniciar sesión</h1>
      <p className="mt-1 text-[13px] text-slate-500">Ingrese con el usuario asignado por el administrador.</p>
      <div className="mt-6 space-y-3.5">
        <div>
          <label className="label">Correo</label>
          <input className="input h-10" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label">Contraseña</label>
          <input className="input h-10" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
        <button className="btn-primary btn-lg w-full" disabled={cargando}>{cargando && <Spinner />}Ingresar</button>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-marca-900 p-10 text-white lg:flex">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-marca-600/30 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-white/10 ring-1 ring-white/20"><Pill className="size-5" /></div>
          <span className="text-lg font-semibold">Vega Pharma Plus</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">La operación de tu botica, en regla y sin papeles.</h2>
          <ul className="mt-8 space-y-4 text-[14px] text-marca-100">
            <li className="flex gap-3"><FileCheck2 className="size-5 shrink-0 text-emerald-300" />Boletas y facturas electrónicas enviadas a SUNAT.</li>
            <li className="flex gap-3"><Boxes className="size-5 shrink-0 text-emerald-300" />Lotes, vencimientos y kardex con salida FEFO automática.</li>
            <li className="flex gap-3"><ShieldCheck className="size-5 shrink-0 text-emerald-300" />Recetas, controlados y Observatorio de Precios DIGEMID.</li>
          </ul>
        </div>
        <p className="relative text-xs text-marca-200/60">© {new Date().getFullYear()} Botica Vega Pharma Plus</p>
      </div>
      <div className="flex items-center justify-center bg-white p-8">
        <Suspense><LoginForm /></Suspense>
      </div>
    </div>
  );
}
