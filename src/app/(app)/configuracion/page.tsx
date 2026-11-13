"use client";
import { useEffect, useState } from "react";
import { Save, Plus } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PageHeader, Field, Spinner } from "@/components/ui";
import { toast } from "@/components/toast";
import { errorMsg } from "@/lib/format";

export default function Configuracion() {
  const sb = supabaseBrowser();
  const [e, setE] = useState<any>(null);
  const [cajas, setCajas] = useState<any[]>([]);
  const [env, setEnv] = useState(false);
  useEffect(() => {
    sb.from("empresa").select("*").eq("id", 1).single().then(({ data }: any) => setE(data));
    sb.from("cajas").select("*").order("id").then(({ data }: any) => setCajas(data ?? []));
  }, [sb]);
  const set = (k: string, v: any) => setE((x: any) => ({ ...x, [k]: v }));

  async function guardar() {
    if (!/^\d{11}$/.test(e.ruc)) return toast.error("El RUC debe tener 11 dígitos.");
    if (e.cod_establecimiento && !/^\d{1,7}$/.test(e.cod_establecimiento)) return toast.error("El código de establecimiento tiene hasta 7 dígitos.");
    setEnv(true);
    const { id, updated_at, ...payload } = e; // eslint-disable-line @typescript-eslint/no-unused-vars
    const { error } = await sb.from("empresa").update(payload).eq("id", 1);
    for (const c of cajas) {
      const { id: cid, ...rest } = c;
      const r = cid ? await sb.from("cajas").update(rest).eq("id", cid) : await sb.from("cajas").insert(rest);
      if (r.error) { toast.error(errorMsg(r.error)); break; }
    }
    // Asegura que existan las series configuradas
    for (const c of cajas) {
      for (const [tipo, serie] of [["03", c.serie_boleta], ["01", c.serie_factura], ["07", c.serie_nc_boleta], ["07", c.serie_nc_factura]]) {
        await sb.from("series").upsert({ tipo, serie }, { onConflict: "tipo,serie", ignoreDuplicates: true });
      }
    }
    setEnv(false);
    if (error) return toast.error(errorMsg(error));
    toast.ok("Configuración guardada. Recargue la página para ver los cambios en el menú.");
  }

  if (!e) return <div className="grid h-64 place-items-center"><Spinner /></div>;
  const inp = (k: string, props: any = {}) => <input className="input" value={e[k] ?? ""} onChange={(ev) => set(k, ev.target.value)} {...props} />;

  return (
    <div className="mx-auto max-w-[1000px] space-y-4">
      <PageHeader title="Configuración" subtitle="Datos del establecimiento que aparecen en comprobantes y reportes"
        actions={<button className="btn-primary" onClick={guardar} disabled={env}>{env ? <Spinner /> : <Save className="size-3.5" />}Guardar cambios</button>} />
      <div className="card p-5">
        <p className="card-t mb-3">Empresa (SUNAT)</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="RUC">{inp("ruc", { maxLength: 11 })}</Field>
          <Field label="Razón social" className="col-span-2">{inp("razon_social")}</Field>
          <Field label="Nombre comercial">{inp("nombre_comercial")}</Field>
          <Field label="Dirección fiscal" className="col-span-2">{inp("direccion")}</Field>
          <Field label="Distrito">{inp("distrito")}</Field><Field label="Provincia">{inp("provincia")}</Field><Field label="Departamento">{inp("departamento")}</Field>
          <Field label="Ubigeo">{inp("ubigeo", { maxLength: 6 })}</Field><Field label="Teléfono">{inp("telefono")}</Field><Field label="Correo">{inp("email")}</Field>
        </div>
      </div>
      <div className="card p-5">
        <p className="card-t mb-3">Establecimiento farmacéutico (DIGEMID)</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Código de establecimiento" hint="CodEstab del Observatorio de Precios (7 dígitos)">{inp("cod_establecimiento", { maxLength: 7 })}</Field>
          <Field label="Resolución de autorización sanitaria" className="col-span-2">{inp("resolucion_autorizacion")}</Field>
          <Field label="Director técnico (Q.F.)" className="col-span-2">{inp("director_tecnico")}</Field>
          <Field label="N° CQFP">{inp("director_cqfp")}</Field>
        </div>
      </div>
      <div className="card p-5">
        <p className="card-t mb-3">Ventas</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="IGV (%)">{inp("igv_porcentaje")}</Field>
          <Field label="Boleta requiere DNI desde (S/)">{inp("monto_boleta_requiere_dni")}</Field>
          <Field label="Alerta de vencimiento (días)">{inp("dias_alerta_vencimiento")}</Field>
          <Field label="Mensaje al pie del ticket" className="col-span-3">{inp("mensaje_ticket")}</Field>
        </div>
      </div>
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between"><p className="card-t">Cajas y series de comprobantes</p>
          <button className="btn-secondary btn-sm" onClick={() => setCajas([...cajas, { nombre: `Caja ${cajas.length + 1}`, serie_boleta: `B00${cajas.length + 1}`, serie_factura: `F00${cajas.length + 1}`, serie_nc_boleta: `BC0${cajas.length + 1}`, serie_nc_factura: `FC0${cajas.length + 1}`, activo: true }])}>
            <Plus className="size-3.5" />Agregar caja</button></div>
        <table className="tbl"><thead><tr><th>Caja</th><th>Serie boleta</th><th>Serie factura</th><th>NC boleta</th><th>NC factura</th><th>Activa</th></tr></thead>
          <tbody>{cajas.map((c, i) => (
            <tr key={i}>{["nombre", "serie_boleta", "serie_factura", "serie_nc_boleta", "serie_nc_factura"].map((k) => (
              <td key={k}><input className="input h-8" maxLength={k === "nombre" ? 40 : 4} value={c[k]} onChange={(ev) => setCajas(cajas.map((x, j) => j === i ? { ...x, [k]: k === "nombre" ? ev.target.value : ev.target.value.toUpperCase() } : x))} /></td>
            ))}<td><input type="checkbox" checked={c.activo} onChange={(ev) => setCajas(cajas.map((x, j) => j === i ? { ...x, activo: ev.target.checked } : x))} /></td></tr>
          ))}</tbody></table>
        <p className="mt-2 text-xs text-zinc-500">Las series de boleta empiezan con B y las de factura con F (4 caracteres), según SUNAT. Cada caja usa sus propias series para evitar choques de numeración.</p>
      </div>
    </div>
  );
}
