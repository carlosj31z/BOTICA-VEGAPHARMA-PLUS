import QRCode from "qrcode";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { S, fechaHora, comprobante, TIPO_COMPROBANTE, METODO_PAGO, TIPO_DOC } from "@/lib/format";
import { numeroALetras } from "@/lib/numero-letras";
import { AutoPrint } from "./auto-print";

export const dynamic = "force-dynamic";

export default async function Ticket({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const [{ data: v }, { data: emp }] = await Promise.all([
    sb.from("ventas").select("*, clientes(*), venta_items(*), pagos(*), perfiles(nombre), ref:venta_referencia_id(serie,numero,tipo)").eq("id", id).single(),
    sb.from("empresa").select("*").eq("id", 1).single(),
  ]);
  if (!v || !emp) notFound();
  const electronico = v.tipo !== "NV";
  const fechaEmision = new Date(v.fecha).toLocaleDateString("en-CA", { timeZone: "America/Lima" });
  // Formato QR SUNAT: RUC|TIPO|SERIE|NUMERO|IGV|TOTAL|FECHA|TIPO DOC CLIENTE|NUM DOC CLIENTE|HASH
  const qrData = [emp.ruc, v.tipo, v.serie, v.numero, Number(v.igv).toFixed(2), Number(v.total).toFixed(2), fechaEmision,
    v.clientes.tipo_documento, v.clientes.numero_documento, v.sunat_hash ?? ""].join("|");
  const qr = electronico ? await QRCode.toString(qrData, { type: "svg", margin: 0, errorCorrectionLevel: "M" }) : "";
  const vuelto = (v.pagos ?? []).reduce((a: number, p: any) => a + Number(p.vuelto || 0), 0);
  const titulo = electronico ? `${TIPO_COMPROBANTE[v.tipo]} electrónica`.toUpperCase().replace("NOTA DE CRÉDITO ELECTRÓNICA", "NOTA DE CRÉDITO ELECTRÓNICA") : "NOTA DE VENTA";

  return (
    <div className="mx-auto w-[300px] p-3 font-mono text-[11px] leading-[1.35] text-black">
      <AutoPrint />
      <style>{`@page { size: 80mm auto; margin: 3mm; } body { background: #fff; }`}</style>
      <div className="text-center">
        <p className="text-[13px] font-bold">{emp.nombre_comercial || emp.razon_social}</p>
        {emp.nombre_comercial && <p>{emp.razon_social}</p>}
        <p>RUC {emp.ruc}</p>
        {emp.direccion && <p>{emp.direccion}</p>}
        {emp.distrito && <p>{[emp.distrito, emp.provincia, emp.departamento].filter(Boolean).join(" - ")}</p>}
        {emp.telefono && <p>Tel. {emp.telefono}</p>}
        <div className="my-2 border-y border-dashed border-black py-1">
          <p className="font-bold">{titulo}</p>
          <p className="text-[13px] font-bold">{comprobante(v.serie, v.numero)}</p>
        </div>
      </div>
      <p>Fecha: {fechaHora(v.fecha)}</p>
      <p>Cliente: {v.clientes.nombre}</p>
      {v.clientes.tipo_documento !== "0" && <p>{TIPO_DOC[v.clientes.tipo_documento]}: {v.clientes.numero_documento}</p>}
      {v.clientes.direccion && <p>Dir.: {v.clientes.direccion}</p>}
      {v.ref && <p>Doc. modificado: {comprobante(v.ref.serie, v.ref.numero)} · Motivo: {v.motivo_nota}</p>}
      <table className="mt-2 w-full border-t border-dashed border-black">
        <thead><tr className="border-b border-dashed border-black"><th className="text-left">Cant.</th><th className="text-left">Descripción</th><th className="text-right">Importe</th></tr></thead>
        <tbody>
          {v.venta_items.map((i: any) => (
            <tr key={i.id} className="align-top">
              <td className="pr-1">{Number(i.cantidad)}</td>
              <td>{i.descripcion}<br /><span className="text-[10px]">{S(i.precio_unitario)} c/u{Number(i.descuento) > 0 ? ` · desc. ${S(i.descuento)}` : ""}</span></td>
              <td className="text-right">{Number(i.total).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 border-t border-dashed border-black pt-1">
        {Number(v.descuento) > 0 && <Row l="Descuentos" r={`-${S(v.descuento)}`} />}
        <Row l="Op. gravada" r={S(v.op_gravada)} />
        {Number(v.op_exonerada) > 0 && <Row l="Op. exonerada" r={S(v.op_exonerada)} />}
        {Number(v.op_inafecta) > 0 && <Row l="Op. inafecta" r={S(v.op_inafecta)} />}
        <Row l={`IGV ${emp.igv_porcentaje}%`} r={S(v.igv)} />
        <div className="flex justify-between text-[13px] font-bold"><span>TOTAL</span><span>{S(v.total)}</span></div>
        <p className="mt-1">SON: {numeroALetras(Number(v.total))}</p>
      </div>
      <div className="mt-1 border-t border-dashed border-black pt-1">
        {(v.pagos ?? []).map((p: any) => (
          <Row key={p.id} l={`${METODO_PAGO[p.metodo]}${p.pos_proveedor ? ` (${p.pos_proveedor})` : ""}${p.numero_operacion ? ` #${p.numero_operacion}` : ""}`} r={S(p.recibido ?? p.monto)} />
        ))}
        {vuelto > 0 && <Row l="Vuelto" r={S(vuelto)} />}
      </div>
      <p className="mt-1">Atendido por: {v.perfiles?.nombre}</p>
      {electronico && (
        <div className="mt-2 flex flex-col items-center text-center">
          <div className="w-28" dangerouslySetInnerHTML={{ __html: qr }} />
          {v.sunat_hash && <p className="mt-1 break-all text-[9px]">Hash: {v.sunat_hash}</p>}
          <p className="mt-1 text-[10px]">Representación impresa de la {TIPO_COMPROBANTE[v.tipo].toLowerCase()} electrónica. Consulte su comprobante en www.sunat.gob.pe</p>
        </div>
      )}
      {!electronico && <p className="mt-2 text-center text-[10px]">Documento interno sin valor tributario. Canjear por boleta o factura.</p>}
      <p className="mt-2 text-center">{emp.mensaje_ticket}</p>
      {emp.director_tecnico && <p className="text-center text-[10px]">D.T.: {/^q\.?f\.?/i.test(emp.director_tecnico) ? "" : "Q.F. "}{emp.director_tecnico}{emp.director_cqfp ? ` · CQFP ${emp.director_cqfp}` : ""}</p>}
    </div>
  );
}

function Row({ l, r }: { l: string; r: string }) {
  return <div className="flex justify-between gap-2"><span>{l}</span><span className="shrink-0">{r}</span></div>;
}
