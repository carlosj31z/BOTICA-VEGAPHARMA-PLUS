import type { ComprobanteElectronico, ProveedorFacturacion, RespuestaEnvio } from "./tipos";

// Nubefact (PSE autorizado por SUNAT). API JSON: https://www.nubefact.com/integracion
// Credenciales: NUBEFACT_RUTA (URL única de su cuenta) y NUBEFACT_TOKEN.
const TIPO: Record<string, number> = { "01": 1, "03": 2, "07": 3, "08": 4 };
const TIPO_IGV: Record<string, number> = { gravado: 1, exonerado: 8, inafecto: 9 };
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function fechaNubefact(d: Date) {
  const s = d.toLocaleDateString("en-CA", { timeZone: "America/Lima" }); // YYYY-MM-DD
  const [y, m, dd] = s.split("-");
  return `${dd}-${m}-${y}`;
}

export class Nubefact implements ProveedorFacturacion {
  nombre = "Nubefact";
  constructor(private ruta: string, private token: string) {}

  private async post(body: Record<string, unknown>): Promise<any> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25_000);
    try {
      const r = await fetch(this.ruta, {
        method: "POST",
        headers: { Authorization: `Token token="${this.token}"`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const j = await r.json().catch(() => ({}));
      return { status: r.status, ...j };
    } finally { clearTimeout(t); }
  }

  private mapear(j: any): RespuestaEnvio {
    if (j.errors) {
      // Código 23: el documento ya existe en Nubefact → se consulta su estado en otro paso.
      return { estado: "error", mensaje: String(j.errors), raw: j };
    }
    const aceptado = j.aceptada_por_sunat === true;
    const codigo = String(j.sunat_responsecode ?? "");
    let estado: RespuestaEnvio["estado"] = aceptado ? "aceptado" : "enviado";
    if (aceptado && j.sunat_note) estado = "observado";
    if (!aceptado && codigo && codigo !== "0" && Number(codigo) >= 2000 && Number(codigo) < 4000) estado = "rechazado";
    return {
      estado,
      mensaje: [j.sunat_description, j.sunat_note].filter(Boolean).join(" · ") || (aceptado ? "Aceptado por SUNAT" : "Recibido por el PSE, pendiente de CDR"),
      hash: j.codigo_hash ?? null, qr: j.cadena_para_codigo_qr ?? null,
      pdfUrl: j.enlace_del_pdf ?? null, xmlUrl: j.enlace_del_xml ?? null, cdrUrl: j.enlace_del_cdr ?? null, raw: j,
    };
  }

  async enviar(c: ComprobanteElectronico): Promise<RespuestaEnvio> {
    const sinDoc = c.cliente.tipoDocumento === "0";
    const body: Record<string, unknown> = {
      operacion: "generar_comprobante",
      tipo_de_comprobante: TIPO[c.tipo],
      serie: c.serie,
      numero: c.numero,
      sunat_transaction: 1,
      cliente_tipo_de_documento: sinDoc ? "-" : c.cliente.tipoDocumento,
      cliente_numero_de_documento: sinDoc ? "-" : c.cliente.numeroDocumento,
      cliente_denominacion: c.cliente.nombre,
      cliente_direccion: c.cliente.direccion ?? "",
      cliente_email: c.cliente.email ?? "",
      fecha_de_emision: fechaNubefact(c.fechaEmision),
      moneda: c.moneda === "USD" ? 2 : 1,
      porcentaje_de_igv: c.igvPorcentaje.toFixed(2),
      total_gravada: c.totales.gravada ? c.totales.gravada.toFixed(2) : "",
      total_exonerada: c.totales.exonerada ? c.totales.exonerada.toFixed(2) : "",
      total_inafecta: c.totales.inafecta ? c.totales.inafecta.toFixed(2) : "",
      total_igv: c.totales.igv.toFixed(2),
      total: c.totales.total.toFixed(2),
      enviar_automaticamente_a_la_sunat: true,
      enviar_automaticamente_al_cliente: !!c.cliente.email,
      formato_de_pdf: "TICKET",
      items: c.items.map((i) => {
        const descSinIgv = i.afectacion === "gravado" ? r2(i.descuento / (1 + c.igvPorcentaje / 100)) : r2(i.descuento);
        return {
          unidad_de_medida: i.unidad,
          codigo: i.codigo ?? "",
          descripcion: i.descripcion,
          cantidad: i.cantidad,
          valor_unitario: i.valorUnitario.toFixed(4),
          precio_unitario: i.precioUnitario.toFixed(4),
          descuento: descSinIgv ? descSinIgv.toFixed(2) : "",
          subtotal: i.valorVenta.toFixed(2),
          tipo_de_igv: TIPO_IGV[i.afectacion],
          igv: i.igv.toFixed(2),
          total: i.total.toFixed(2),
          anticipo_regularizacion: false,
        };
      }),
    };
    if (c.referencia) {
      body.documento_que_se_modifica_tipo = TIPO[c.referencia.tipo];
      body.documento_que_se_modifica_serie = c.referencia.serie;
      body.documento_que_se_modifica_numero = c.referencia.numero;
      body[c.tipo === "07" ? "tipo_de_nota_de_credito" : "tipo_de_nota_de_debito"] = Number(c.referencia.tipoNota);
      body.observaciones = c.referencia.motivo;
    }
    const j = await this.post(body);
    if (j.errors && String(j.codigo) === "23") return this.consultar(c); // ya existía: reconsultar
    return this.mapear(j);
  }

  async consultar(c: Pick<ComprobanteElectronico, "tipo" | "serie" | "numero">) {
    const j = await this.post({ operacion: "consultar_comprobante", tipo_de_comprobante: TIPO[c.tipo], serie: c.serie, numero: c.numero });
    return this.mapear(j);
  }

  async anular(c: Pick<ComprobanteElectronico, "tipo" | "serie" | "numero">, motivo: string) {
    const j = await this.post({ operacion: "generar_anulacion", tipo_de_comprobante: TIPO[c.tipo], serie: c.serie, numero: c.numero, motivo, codigo_unico: "" });
    if (j.errors) return { estado: "error" as const, mensaje: String(j.errors), raw: j };
    return { estado: j.aceptada_por_sunat ? ("aceptado" as const) : ("enviado" as const), mensaje: j.sunat_description ?? "Comunicación de baja enviada", raw: j };
  }
}
