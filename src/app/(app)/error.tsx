"use client";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function ErrorPagina({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto mt-20 max-w-md card p-6 text-center">
      <AlertTriangle className="mx-auto size-8 text-amber-500" />
      <h2 className="mt-3 font-semibold text-slate-900">Esta pantalla tuvo un problema</h2>
      <p className="mt-1 text-[13px] text-slate-500">El resto del sistema sigue funcionando. Puede reintentar sin perder su sesión.</p>
      <p className="mt-3 rounded bg-slate-50 p-2 text-left font-mono text-[11px] text-slate-500">{error.message}</p>
      <button onClick={reset} className="btn-primary mt-4"><RotateCcw className="size-4" />Reintentar</button>
    </div>
  );
}
