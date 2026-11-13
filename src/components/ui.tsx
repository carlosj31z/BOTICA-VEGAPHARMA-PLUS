"use client";
import { useEffect, type ReactNode } from "react";
import { X, Loader2, Inbox } from "lucide-react";
import clsx from "clsx";

export function Modal({ open, onClose, title, children, footer, size = "md" }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-900/30 p-6 pt-[8vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={clsx("w-full rounded-lg bg-white shadow-xl ring-1 ring-zinc-900/5", w)}>
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 h-12">
          <h2 className="text-[14px] font-semibold text-zinc-900">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"><X className="size-4" /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-zinc-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[17px] font-semibold tracking-tight text-zinc-900">{title}</h1>
        {subtitle && <p className="text-[12.5px] text-zinc-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, children, className, hint }: { label: string; children: ReactNode; className?: string; hint?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-zinc-400">{hint}</span>}
    </label>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("size-4 animate-spin", className)} />;
}

export function Empty({ text = "Sin registros", icon }: { text?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-zinc-400">
      {icon ?? <Inbox className="size-6" strokeWidth={1.5} />}
      <p className="text-[13px]">{text}</p>
    </div>
  );
}

export function Stat({ label, value, hint, tone = "slate" }: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: "slate" | "green" | "amber" | "red" | "blue";
}) {
  const dot = { slate: "", green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-rose-500", blue: "bg-sky-500" }[tone];
  return (
    <div className="card px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-zinc-500">{dot && <span className={clsx("size-1.5 rounded-full", dot)} />}{label}</p>
      <p className="mt-0.5 text-[20px] font-semibold tabular-nums tracking-tight text-zinc-900">{value}</p>
      {hint && <p className="text-[11.5px] text-zinc-500">{hint}</p>}
    </div>
  );
}
