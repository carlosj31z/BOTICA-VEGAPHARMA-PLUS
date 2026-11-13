"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

type T = { id: number; tipo: "ok" | "error" | "info"; texto: string };
let push: ((t: Omit<T, "id">) => void) | null = null;

export const toast = {
  ok: (texto: string) => push?.({ tipo: "ok", texto }),
  error: (texto: string) => push?.({ tipo: "error", texto }),
  info: (texto: string) => push?.({ tipo: "info", texto }),
};

export function Toaster() {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    push = (t) => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { ...t, id }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.tipo === "error" ? 7000 : 3500);
    };
    return () => { push = null; };
  }, []);
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex w-96 flex-col gap-2 no-print">
      {items.map((t) => (
        <div key={t.id} className={`flex items-start gap-2.5 rounded-lg border bg-white px-3.5 py-3 shadow-lg ${
          t.tipo === "error" ? "border-rose-200" : t.tipo === "ok" ? "border-emerald-200" : "border-zinc-200"}`}>
          {t.tipo === "ok" ? <CheckCircle2 className="mt-0.5 size-4 text-emerald-600 shrink-0" />
            : t.tipo === "error" ? <AlertTriangle className="mt-0.5 size-4 text-rose-600 shrink-0" />
            : <Info className="mt-0.5 size-4 text-sky-600 shrink-0" />}
          <p className="flex-1 text-[13px] leading-snug text-zinc-700">{t.texto}</p>
          <button onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))} className="text-zinc-400 hover:text-zinc-600">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
