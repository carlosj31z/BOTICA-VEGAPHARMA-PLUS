"use client";
import { useEffect } from "react";
export function AutoPrint() {
  useEffect(() => { const t = setTimeout(() => window.print(), 300); return () => clearTimeout(t); }, []);
  return (
    <div className="no-print mb-3 flex gap-2">
      <button onClick={() => window.print()} className="btn-primary btn-sm">Imprimir</button>
      <button onClick={() => window.close()} className="btn-secondary btn-sm">Cerrar</button>
    </div>
  );
}
