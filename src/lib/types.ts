export type Rol = "admin" | "quimico" | "cajero" | "almacen";
export interface Perfil { id: string; nombre: string; email: string | null; dni: string | null; rol: Rol; activo: boolean }
export interface Producto {
  id: number; codigo: string | null; codigo_barras: string | null; nombre: string; principio_activo: string | null;
  concentracion: string | null; forma_farmaceutica: string | null; presentacion: string | null;
  laboratorio_id: number | null; categoria_id: number | null; registro_sanitario: string | null; codigo_digemid: string | null;
  condicion_venta: "libre" | "receta" | "receta_retenida" | "controlado"; lista_control: string | null;
  unidades_por_empaque: number; precio_unidad: number; precio_empaque: number; costo_promedio: number;
  unidades_por_blister?: number; precio_blister?: number;
  afectacion_igv: "gravado" | "exonerado" | "inafecto"; stock_minimo: number; ubicacion: string | null;
  refrigerado: boolean; activo: boolean;
  laboratorio?: string | null; categoria?: string | null; stock?: number; stock_vendible?: number; proximo_vencimiento?: string | null;
}
export interface Lote { id: number; producto_id: number; numero_lote: string; fecha_vencimiento: string; stock: number; costo_unitario: number }
export interface Turno { id: number; caja_id: number; usuario_id: string; estado: string; abierto_at: string; monto_apertura: number }
