export function EstadoSunat({ e }: { e: string }) {
  const m: Record<string, [string, string]> = {
    aceptado: ["badge-green", "Aceptado"], pendiente: ["badge-amber", "Pendiente"], enviado: ["badge-blue", "Enviado"],
    observado: ["badge-amber", "Observado"], rechazado: ["badge-red", "Rechazado"], error: ["badge-red", "Error"],
    anulado: ["badge-gray", "Anulado"], no_aplica: ["badge-gray", "No aplica"],
  };
  const [c, l] = m[e] ?? ["badge-gray", e];
  return <span className={c}>{l}</span>;
}
