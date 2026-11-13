"use client";
import { CrudSimple } from "@/components/crud-simple";
export default function Proveedores() {
  return <CrudSimple tabla="proveedores" titulo="Proveedores" subtitulo="Droguerías y laboratorios con su autorización sanitaria" orden="razon_social"
    busqueda={["razon_social", "ruc"]}
    validar={(f) => (/^\d{11}$/.test(f.ruc ?? "") ? null : "El RUC debe tener 11 dígitos.")}
    campos={[
      { k: "ruc", l: "RUC", req: true }, { k: "razon_social", l: "Razón social", req: true, upper: true },
      { k: "autorizacion_digemid", l: "Autorización sanitaria", tabla: false }, { k: "contacto", l: "Contacto" },
      { k: "telefono", l: "Teléfono" }, { k: "email", l: "Correo", tabla: false }, { k: "direccion", l: "Dirección", ancho: 2, tabla: false },
      { k: "activo", l: "Activo", tipo: "check" },
    ]} />;
}
