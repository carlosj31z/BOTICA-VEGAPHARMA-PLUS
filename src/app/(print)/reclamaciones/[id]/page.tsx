import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { S, fechaHora } from "@/lib/format";
import { AutoPrint } from "../../ventas/[id]/ticket/auto-print";

export const dynamic = "force-dynamic";

/** Hoja de reclamación (formato del Libro de Reclamaciones, D.S. 011-2011-PCM). Se entrega copia al consumidor. */
export default async function HojaReclamacion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const [{ data: r }, { data: e }] = await Promise.all([
    sb.from("reclamaciones").select("*").eq("id", id).single(),
    sb.from("empresa").select("*").eq("id", 1).single(),
  ]);
  if (!r) notFound();
  const Box = ({ t, children }: { t: string; children: React.ReactNode }) => (
    <div className="border border-black"><p className="bg-zinc-100 px-2 py-0.5 text-[10px] font-bold">{t}</p><div className="px-2 py-1.5">{children}</div></div>
  );
  const F = ({ l, v }: { l: string; v?: string | null }) => <p><span className="text-zinc-600">{l}: </span>{v || "—"}</p>;
  return (
    <div className="mx-auto max-w-[720px] space-y-2 p-6 text-[11.5px] leading-snug text-black">
      <AutoPrint />
      <style>{`@page { size: A4; margin: 12mm; }`}</style>
      <div className="flex items-start justify-between border border-black p-2">
        <div>
          <p className="text-[14px] font-bold">LIBRO DE RECLAMACIONES</p>
          <p>{e?.razon_social} · RUC {e?.ruc}</p>
          <p>{e?.direccion}</p>
        </div>
        <div className="text-right">
          <p className="font-bold">HOJA DE RECLAMACIÓN</p>
          <p className="text-[14px] font-bold">N° {r.numero}</p>
          <p>{fechaHora(r.fecha)}</p>
        </div>
      </div>
      <Box t="1. IDENTIFICACIÓN DEL CONSUMIDOR RECLAMANTE">
        <div className="grid grid-cols-2 gap-x-4">
          <F l="Nombre" v={r.consumidor_nombre} /><F l="DNI / CE" v={r.consumidor_documento} />
          <F l="Domicilio" v={r.consumidor_domicilio} /><F l="Teléfono" v={r.consumidor_telefono} />
          <F l="Correo" v={r.consumidor_email} /><F l="Padre o madre (menor de edad)" v={r.apoderado} />
        </div>
      </Box>
      <Box t="2. IDENTIFICACIÓN DEL BIEN CONTRATADO">
        <F l={r.bien_tipo === "producto" ? "Producto" : "Servicio"} v={r.bien_descripcion} />
        <F l="Monto reclamado" v={r.monto != null ? S(r.monto) : null} />
      </Box>
      <Box t="3. DETALLE DE LA RECLAMACIÓN Y PEDIDO DEL CONSUMIDOR">
        <p className="mb-1"><b>{r.tipo === "reclamo" ? "RECLAMO" : "QUEJA"}</b> <span className="text-[10px] text-zinc-600">
          ({r.tipo === "reclamo" ? "disconformidad relacionada a los productos o servicios" : "disconformidad no relacionada a los productos o servicios, o malestar respecto a la atención"})</span></p>
        <p className="whitespace-pre-line">{r.detalle}</p>
        <p className="mt-2"><span className="text-zinc-600">Pedido: </span>{r.pedido}</p>
        <div className="mt-8 flex justify-end"><p className="w-56 border-t border-black pt-0.5 text-center text-[10px]">Firma del consumidor</p></div>
      </Box>
      <Box t="4. OBSERVACIONES Y ACCIONES ADOPTADAS POR EL PROVEEDOR">
        <p className="min-h-12 whitespace-pre-line">{r.respuesta || ""}</p>
        {r.respondido_at && <p className="mt-1 text-[10px]">Fecha de respuesta: {fechaHora(r.respondido_at)}</p>}
      </Box>
      <p className="text-[9.5px] text-zinc-700">
        La formulación del reclamo no impide acudir a otras vías de solución de controversias ni es requisito previo para interponer una denuncia ante el INDECOPI.
        El proveedor deberá dar respuesta al reclamo en un plazo no mayor a quince (15) días hábiles.
      </p>
    </div>
  );
}
