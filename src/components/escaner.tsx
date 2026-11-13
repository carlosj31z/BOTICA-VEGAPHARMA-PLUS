"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, X, Zap } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Pitido corto de confirmación (sin archivos de audio). */
export function pitido(ok = true) {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = ok ? 1800 : 300; o.type = "square"; g.gain.value = 0.04;
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (ok ? 0.07 : 0.25));
    o.onended = () => ctx.close();
  } catch {}
  try { navigator.vibrate?.(ok ? 40 : [80, 40, 80]); } catch {}
}

/**
 * Lector USB tradicional (modo teclado): el lector "escribe" el código muy rápido y termina con Enter.
 * Este gancho detecta esa ráfaga aunque el cursor no esté en el buscador, y entrega el código.
 * Si el cursor está en otro campo de texto, no interfiere.
 */
export function useLectorUSB(onCodigo: (codigo: string) => void, activo = true) {
  const cb = useRef(onCodigo); cb.current = onCodigo;
  useEffect(() => {
    if (!activo) return;
    let buf = "", ultimo = 0;
    const h = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) { buf = ""; return; }
      const ahora = performance.now();
      if (ahora - ultimo > 60) buf = "";
      ultimo = ahora;
      if (e.key === "Enter") {
        if (buf.length >= 4) { e.preventDefault(); cb.current(buf); }
        buf = ""; return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) buf += e.key;
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [activo]);
}

const FORMATOS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"];

/**
 * Lectura con cámara: usa BarcodeDetector (Chrome/Android/Edge) y, si no existe (iPhone/Safari), ZXing.
 * Llama a onCodigo por cada código leído; ignora el mismo código durante 1,5 s.
 */
export function VisorCamara({ onCodigo, className }: { onCodigo: (codigo: string) => void; className?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const cb = useRef(onCodigo); cb.current = onCodigo;
  const [error, setError] = useState("");
  const [linterna, setLinterna] = useState<MediaStreamTrack | null>(null);
  const [luz, setLuz] = useState(false);

  useEffect(() => {
    let detener = () => {};
    let vivo = true;
    let ultimo = { c: "", t: 0 };
    const entregar = (c: string) => {
      const t = Date.now();
      if (c === ultimo.c && t - ultimo.t < 1500) return;
      ultimo = { c, t }; pitido(); cb.current(c);
    };
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false });
        if (!vivo) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = video.current!; v.srcObject = stream; await v.play();
        const track = stream.getVideoTracks()[0];
        if ((track.getCapabilities?.() as any)?.torch) setLinterna(track);
        const BD = (window as any).BarcodeDetector;
        const soportados: string[] = BD ? await BD.getSupportedFormats().catch(() => []) : [];
        if (BD && soportados.includes("ean_13")) {
          const det = new BD({ formats: FORMATOS.filter((f) => soportados.includes(f)) });
          let raf = 0;
          const loop = async () => {
            if (!vivo) return;
            try { const r = await det.detect(v); if (r[0]?.rawValue) entregar(r[0].rawValue); } catch {}
            raf = window.setTimeout(loop, 120);
          };
          loop();
          detener = () => { clearTimeout(raf); stream.getTracks().forEach((t) => t.stop()); };
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 120 });
          const ctrl = await reader.decodeFromVideoElement(v, (res) => { if (res) entregar(res.getText()); });
          detener = () => { ctrl.stop(); stream.getTracks().forEach((t) => t.stop()); };
        }
      } catch (e: any) {
        setError(e?.name === "NotAllowedError" ? "Permita el acceso a la cámara para leer códigos." :
          location.protocol !== "https:" && location.hostname !== "localhost" ? "La cámara solo funciona con https." : "No se pudo abrir la cámara.");
      }
    })();
    return () => { vivo = false; detener(); };
  }, []);

  return (
    <div className={`relative overflow-hidden rounded-lg bg-black ${className ?? ""}`}>
      <video ref={video} muted playsInline className="h-full w-full object-cover" />
      <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-md border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,.35)]">
        <div className="absolute inset-x-2 top-1/2 h-px bg-rose-500/80" />
      </div>
      {linterna && (
        <button onClick={async () => { const n = !luz; await linterna.applyConstraints({ advanced: [{ torch: n } as any] }).catch(() => {}); setLuz(n); }}
          className="absolute right-3 top-3 rounded-full bg-black/50 p-2 text-white"><Zap className={`size-4 ${luz ? "fill-yellow-300 text-yellow-300" : ""}`} /></button>
      )}
      {error && <p className="absolute inset-0 grid place-items-center p-6 text-center text-[13px] text-white">{error}</p>}
    </div>
  );
}

export function ModalCamara({ onCodigo, onClose }: { onCodigo: (c: string) => void; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/60 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex h-11 items-center justify-between border-b border-zinc-100 px-4">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-zinc-900"><Camera className="size-4" />Leer con cámara</p>
          <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-100"><X className="size-4" /></button>
        </div>
        <VisorCamara onCodigo={onCodigo} className="aspect-[4/3]" />
        <p className="px-4 py-2 text-[11.5px] text-zinc-500">Apunte al código de barras. Cada lectura se agrega a la venta; cierre cuando termine.</p>
      </div>
    </div>
  );
}

/** Canal en tiempo real entre el celular (lector) y la computadora (punto de venta) del mismo usuario. */
export const canalEscaner = (usuarioId: string) => `escaner-${usuarioId}`;

export function useCodigosRemotos(usuarioId: string, onCodigo: (c: string) => void) {
  const cb = useRef(onCodigo); cb.current = onCodigo;
  const [celulares, setCelulares] = useState(0);
  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb.channel(canalEscaner(usuarioId), { config: { presence: { key: "pos" } } });
    ch.on("broadcast", { event: "codigo" }, ({ payload }: any) => { if (payload?.codigo) cb.current(String(payload.codigo)); })
      .on("presence", { event: "sync" }, () => {
        const st = ch.presenceState() as Record<string, any[]>;
        setCelulares(Object.values(st).flat().filter((p: any) => p.rol === "lector").length);
      })
      .subscribe((s: string) => { if (s === "SUBSCRIBED") ch.track({ rol: "pos" }); });
    return () => { sb.removeChannel(ch); };
  }, [usuarioId]);
  return celulares;
}
