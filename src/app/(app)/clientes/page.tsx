"use client";
import { CrudSimple } from "@/components/crud-simple";
export default function Clientes() {
  return <CrudSimple tabla="clientes" titulo="Clientes" subtitulo="Se crean automáticamente al emitir boletas con DNI o facturas con RUC" orden="nombre"
    busqueda={["nombre", "numero_documento"]}
    validar={(f) => f.tipo_documento === "1" && !/^\d{8}$/.test(f.numero_documento ?? "") ? "El DNI debe tener 8 dígitos."
      : f.tipo_documento === "6" && !/^\d{11}$/.test(f.numero_documento ?? "") ? "El RUC debe tener 11 dígitos." : null}
    campos={[
      { k: "tipo_documento", l: "Tipo doc.", opciones: [["1", "DNI"], ["6", "RUC"], ["4", "C. extranjería"], ["7", "Pasaporte"]] },
      { k: "numero_documento", l: "Número", req: true }, { k: "nombre", l: "Nombre / razón social", req: true, upper: true, ancho: 2 },
      { k: "telefono", l: "Teléfono" }, { k: "email", l: "Correo" }, { k: "direccion", l: "Dirección", ancho: 2 },
    ]} />;
}
