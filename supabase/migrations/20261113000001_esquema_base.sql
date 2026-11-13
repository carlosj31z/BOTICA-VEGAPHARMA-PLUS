-- =====================================================================
-- ERP Botica · Esquema base
-- Operación diaria de una botica peruana: productos con datos DIGEMID,
-- lotes y vencimientos, kardex valorizado, compras, ventas con
-- comprobantes electrónicos SUNAT, pagos (efectivo/POS/billeteras),
-- caja por turnos, recetas y auditoría.
-- Todas las cantidades de stock se guardan en UNIDADES mínimas (fracción).
-- =====================================================================

create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type rol_usuario as enum ('admin', 'quimico', 'cajero', 'almacen');
create type condicion_venta as enum ('libre', 'receta', 'receta_retenida', 'controlado');
create type afectacion_igv as enum ('gravado', 'exonerado', 'inafecto');
create type tipo_movimiento as enum (
  'inventario_inicial', 'compra', 'venta', 'devolucion_venta', 'devolucion_proveedor',
  'ajuste_entrada', 'ajuste_salida', 'merma', 'vencimiento'
);
-- Catálogo 01 SUNAT: 01 factura, 03 boleta, 07 nota de crédito, 08 nota de débito.
-- 'NV' = nota de venta interna (no se envía a SUNAT).
create type tipo_comprobante as enum ('01', '03', '07', '08', 'NV');
create type estado_sunat as enum ('no_aplica', 'pendiente', 'enviado', 'aceptado', 'observado', 'rechazado', 'anulado', 'error');
create type metodo_pago as enum ('efectivo', 'tarjeta_debito', 'tarjeta_credito', 'yape', 'plin', 'transferencia');
create type estado_turno as enum ('abierto', 'cerrado');

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Empresa / establecimiento (una fila)
-- ---------------------------------------------------------------------
create table public.empresa (
  id smallint primary key default 1 check (id = 1),
  ruc varchar(11) not null default '00000000000',
  razon_social text not null default 'MI BOTICA S.A.C.',
  nombre_comercial text,
  direccion text,
  ubigeo varchar(6),
  distrito text,
  provincia text,
  departamento text,
  telefono text,
  email text,
  -- DIGEMID
  cod_establecimiento varchar(7),          -- código del Observatorio / RENIPRESS-DIGEMID
  resolucion_autorizacion text,
  director_tecnico text,
  director_cqfp varchar(10),               -- colegiatura químico farmacéutico
  -- Ventas
  igv_porcentaje numeric(5,2) not null default 18.00,
  dias_alerta_vencimiento int not null default 90,
  monto_boleta_requiere_dni numeric(12,2) not null default 700.00, -- SUNAT: boletas > S/700 requieren identificar al cliente
  permitir_venta_sin_stock boolean not null default false,
  mensaje_ticket text default 'Gracias por su preferencia',
  updated_at timestamptz not null default now()
);
insert into public.empresa (id) values (1);
create trigger trg_empresa_upd before update on public.empresa for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Usuarios (perfil sobre auth.users)
-- ---------------------------------------------------------------------
create table public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  email text,
  dni varchar(8),
  rol rol_usuario not null default 'cajero',
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_perfiles_upd before update on public.perfiles for each row execute function set_updated_at();

-- El primer usuario es administrador. Los siguientes toman el rol de app_metadata, que solo puede fijar
-- el servidor (alta desde Usuarios). Un registro público (signup) queda INACTIVO y sin permisos.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_rol rol_usuario := 'cajero';
  v_activo boolean := false;
begin
  if not exists (select 1 from public.perfiles) then
    v_rol := 'admin'; v_activo := true;
  elsif coalesce(new.raw_app_meta_data->>'creado_por_admin', '') = 'true' then
    v_rol := coalesce((new.raw_app_meta_data->>'rol')::rol_usuario, 'cajero'); v_activo := true;
  end if;
  insert into public.perfiles (id, nombre, email, rol, activo)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)), new.email, v_rol, v_activo);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.mi_rol() returns rol_usuario
language sql stable security definer set search_path = public as $$
  select rol from public.perfiles where id = auth.uid() and activo
$$;

create or replace function public.es_usuario_activo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and activo)
$$;

create or replace function public.tiene_rol(roles rol_usuario[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() = any(roles), false)
$$;

-- ---------------------------------------------------------------------
-- Maestros de productos
-- ---------------------------------------------------------------------
create table public.laboratorios (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  pais text,
  activo boolean not null default true
);

create table public.categorias (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  activo boolean not null default true
);

create table public.productos (
  id bigint generated always as identity primary key,
  codigo varchar(30) unique,                     -- código interno
  codigo_barras varchar(30),
  nombre text not null,                          -- nombre comercial
  principio_activo text,                         -- DCI
  concentracion text,
  forma_farmaceutica text,
  presentacion text,                             -- ej. "Caja x 100 tabletas"
  laboratorio_id bigint references public.laboratorios(id),
  categoria_id bigint references public.categorias(id),
  registro_sanitario varchar(30),
  codigo_digemid varchar(20),                    -- CodProd del catálogo del Observatorio
  condicion_venta condicion_venta not null default 'libre',
  lista_control text,                            -- ej. IIA, IIB, IIIA... (estupefacientes/psicotrópicos)
  unidades_por_empaque int not null default 1 check (unidades_por_empaque >= 1),
  precio_unidad numeric(12,2) not null default 0 check (precio_unidad >= 0),     -- con IGV
  precio_empaque numeric(12,2) not null default 0 check (precio_empaque >= 0),   -- con IGV
  costo_promedio numeric(14,4) not null default 0,                               -- por unidad, sin IGV
  afectacion_igv afectacion_igv not null default 'gravado',
  stock_minimo int not null default 0,
  ubicacion text,
  refrigerado boolean not null default false,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_productos_barras on public.productos(codigo_barras);
create index idx_productos_nombre_trgm on public.productos using gin (nombre gin_trgm_ops);
create index idx_productos_pa_trgm on public.productos using gin (principio_activo gin_trgm_ops);
create index idx_productos_digemid on public.productos(codigo_digemid);
create trigger trg_productos_upd before update on public.productos for each row execute function set_updated_at();

create table public.lotes (
  id bigint generated always as identity primary key,
  producto_id bigint not null references public.productos(id),
  numero_lote varchar(40) not null,
  fecha_vencimiento date not null,
  stock int not null default 0 check (stock >= 0),       -- unidades
  costo_unitario numeric(14,4) not null default 0,       -- por unidad, sin IGV
  created_at timestamptz not null default now(),
  unique (producto_id, numero_lote)
);
create index idx_lotes_fefo on public.lotes(producto_id, fecha_vencimiento) where stock > 0;

-- Stock total por producto (vista para lectura rápida)
create or replace view public.v_stock with (security_invoker = true) as
select p.id as producto_id,
       coalesce(sum(l.stock), 0)::int as stock,
       coalesce(sum(l.stock) filter (where l.fecha_vencimiento >= current_date), 0)::int as stock_vendible,
       min(l.fecha_vencimiento) filter (where l.stock > 0) as proximo_vencimiento
from public.productos p
left join public.lotes l on l.producto_id = p.id
group by p.id;

-- Kardex
create table public.movimientos (
  id bigint generated always as identity primary key,
  producto_id bigint not null references public.productos(id),
  lote_id bigint references public.lotes(id),
  tipo tipo_movimiento not null,
  cantidad int not null,                 -- unidades (+ entra / - sale)
  costo_unitario numeric(14,4) not null default 0,
  saldo int not null,                    -- stock total del producto después del movimiento
  referencia text,                       -- ej. "B001-00000123", "Compra F001-456"
  venta_id bigint,
  compra_id bigint,
  nota text,
  usuario_id uuid references public.perfiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index idx_mov_producto on public.movimientos(producto_id, created_at desc);

-- ---------------------------------------------------------------------
-- Terceros
-- ---------------------------------------------------------------------
create table public.proveedores (
  id bigint generated always as identity primary key,
  ruc varchar(11) not null unique,
  razon_social text not null,
  direccion text,
  telefono text,
  email text,
  contacto text,
  autorizacion_digemid text,             -- N° de autorización sanitaria de la droguería
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Catálogo 06 SUNAT: 0 sin documento, 1 DNI, 4 carné de extranjería, 6 RUC, 7 pasaporte
create table public.clientes (
  id bigint generated always as identity primary key,
  tipo_documento varchar(1) not null default '1' check (tipo_documento in ('0','1','4','6','7')),
  numero_documento varchar(15) not null,
  nombre text not null,
  direccion text,
  telefono text,
  email text,
  created_at timestamptz not null default now(),
  unique (tipo_documento, numero_documento)
);
insert into public.clientes (tipo_documento, numero_documento, nombre) values ('0', '-', 'CLIENTES VARIOS');

-- ---------------------------------------------------------------------
-- Compras
-- ---------------------------------------------------------------------
create table public.compras (
  id bigint generated always as identity primary key,
  proveedor_id bigint not null references public.proveedores(id),
  tipo_documento varchar(2) not null default '01',  -- 01 factura, 09 guía, etc.
  serie_numero varchar(20) not null,
  fecha date not null default current_date,
  subtotal numeric(12,2) not null default 0,
  igv numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  observacion text,
  usuario_id uuid references public.perfiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (proveedor_id, serie_numero)
);

create table public.compra_items (
  id bigint generated always as identity primary key,
  compra_id bigint not null references public.compras(id) on delete cascade,
  producto_id bigint not null references public.productos(id),
  lote_id bigint references public.lotes(id),
  numero_lote varchar(40) not null,
  fecha_vencimiento date not null,
  cantidad int not null check (cantidad > 0),     -- unidades
  costo_unitario numeric(14,4) not null,          -- por unidad, sin IGV
  total numeric(12,2) not null
);

-- ---------------------------------------------------------------------
-- Caja y turnos
-- ---------------------------------------------------------------------
create table public.cajas (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  serie_boleta varchar(4) not null default 'B001',
  serie_factura varchar(4) not null default 'F001',
  serie_nc_boleta varchar(4) not null default 'BC01',
  serie_nc_factura varchar(4) not null default 'FC01',
  activo boolean not null default true
);
insert into public.cajas (nombre) values ('Caja 1');

create table public.turnos (
  id bigint generated always as identity primary key,
  caja_id bigint not null references public.cajas(id),
  usuario_id uuid not null references public.perfiles(id),
  estado estado_turno not null default 'abierto',
  abierto_at timestamptz not null default now(),
  cerrado_at timestamptz,
  monto_apertura numeric(12,2) not null default 0,
  efectivo_esperado numeric(12,2),
  efectivo_contado numeric(12,2),
  diferencia numeric(12,2),
  resumen jsonb,
  observacion text
);
-- Un solo turno abierto por caja y por usuario
create unique index uq_turno_abierto_caja on public.turnos(caja_id) where estado = 'abierto';
create unique index uq_turno_abierto_usuario on public.turnos(usuario_id) where estado = 'abierto';

create table public.movimientos_caja (
  id bigint generated always as identity primary key,
  turno_id bigint not null references public.turnos(id),
  tipo text not null check (tipo in ('ingreso', 'egreso')),
  monto numeric(12,2) not null check (monto > 0),
  concepto text not null,
  usuario_id uuid references public.perfiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Comprobantes / ventas
-- ---------------------------------------------------------------------
create table public.series (
  tipo tipo_comprobante not null,
  serie varchar(4) not null,
  correlativo int not null default 0,
  primary key (tipo, serie)
);
insert into public.series (tipo, serie) values ('03','B001'), ('01','F001'), ('07','BC01'), ('07','FC01'), ('NV','NV01');

create table public.recetas (
  id bigint generated always as identity primary key,
  numero text,
  fecha_receta date not null default current_date,
  paciente_nombre text not null,
  paciente_documento varchar(15),
  medico_nombre text not null,
  medico_cmp varchar(10) not null,           -- colegiatura del prescriptor
  establecimiento_origen text,
  diagnostico text,
  retenida boolean not null default false,   -- receta retenida en el establecimiento
  observacion text,
  created_at timestamptz not null default now()
);

create table public.ventas (
  id bigint generated always as identity primary key,
  turno_id bigint references public.turnos(id),
  cliente_id bigint not null references public.clientes(id),
  tipo tipo_comprobante not null,
  serie varchar(4) not null,
  numero int not null,
  fecha timestamptz not null default now(),
  moneda varchar(3) not null default 'PEN',
  op_gravada numeric(12,2) not null default 0,
  op_exonerada numeric(12,2) not null default 0,
  op_inafecta numeric(12,2) not null default 0,
  igv numeric(12,2) not null default 0,
  descuento numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  redondeo numeric(12,2) not null default 0,
  anulada boolean not null default false,
  motivo_anulacion text,
  -- Nota de crédito
  venta_referencia_id bigint references public.ventas(id),
  tipo_nota varchar(2),                      -- catálogo 09 SUNAT
  motivo_nota text,
  receta_id bigint references public.recetas(id),
  -- Estado electrónico
  sunat_estado estado_sunat not null default 'pendiente',
  sunat_mensaje text,
  sunat_hash text,
  sunat_qr text,
  sunat_pdf_url text,
  sunat_xml_url text,
  sunat_cdr_url text,
  sunat_intentos int not null default 0,
  sunat_enviado_at timestamptz,
  usuario_id uuid references public.perfiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (tipo, serie, numero)
);
create index idx_ventas_fecha on public.ventas(fecha desc);
create index idx_ventas_sunat on public.ventas(sunat_estado) where sunat_estado in ('pendiente','error','observado');

create table public.venta_items (
  id bigint generated always as identity primary key,
  venta_id bigint not null references public.ventas(id) on delete cascade,
  producto_id bigint not null references public.productos(id),
  lote_id bigint references public.lotes(id),
  descripcion text not null,
  unidad text not null default 'NIU',        -- NIU unidad / BX caja (catálogo 03)
  cantidad numeric(12,3) not null,           -- en la unidad vendida
  cantidad_unidades int not null,            -- unidades descontadas del stock
  precio_unitario numeric(12,4) not null,    -- con IGV, por unidad vendida
  valor_unitario numeric(12,4) not null,     -- sin IGV
  descuento numeric(12,2) not null default 0,
  afectacion_igv afectacion_igv not null,
  valor_venta numeric(12,2) not null,        -- base imponible de la línea
  igv numeric(12,2) not null,
  total numeric(12,2) not null,
  costo_unitario numeric(14,4) not null default 0
);
create index idx_vitems_venta on public.venta_items(venta_id);
create index idx_vitems_producto on public.venta_items(producto_id);

create table public.pagos (
  id bigint generated always as identity primary key,
  venta_id bigint not null references public.ventas(id) on delete cascade,
  metodo metodo_pago not null,
  monto numeric(12,2) not null check (monto > 0),   -- monto aplicado a la venta
  recibido numeric(12,2),                           -- efectivo entregado por el cliente
  vuelto numeric(12,2) not null default 0,
  pos_proveedor text,                               -- niubiz, izipay, openpay, culqi...
  numero_operacion text,                            -- voucher / ID de operación
  marca_tarjeta text,
  ultimos4 varchar(4),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------
create table public.auditoria (
  id bigint generated always as identity primary key,
  tabla text not null,
  accion text not null,
  registro_id text,
  datos jsonb,
  usuario_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create or replace function public.fn_auditar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.auditoria (tabla, accion, registro_id, datos)
  values (tg_table_name, tg_op,
          coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id', ''),
          case when tg_op = 'UPDATE' then jsonb_build_object('antes', to_jsonb(old), 'despues', to_jsonb(new))
               when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger aud_productos after insert or update or delete on public.productos for each row execute function fn_auditar();
create trigger aud_perfiles after insert or update or delete on public.perfiles for each row execute function fn_auditar();
create trigger aud_empresa after update on public.empresa for each row execute function fn_auditar();
create trigger aud_turnos after update on public.turnos for each row execute function fn_auditar();
