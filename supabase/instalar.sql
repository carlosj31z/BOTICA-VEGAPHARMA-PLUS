-- =====================================================================
-- ERP Botica · Instalación completa en Supabase (pegar en SQL Editor y ejecutar una sola vez)
-- Generado a partir de supabase/migrations. No incluye datos de demostración.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 20261113000001_esquema_base.sql
-- ---------------------------------------------------------------------
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


-- ---------------------------------------------------------------------
-- 20261113000002_funciones.sql
-- ---------------------------------------------------------------------
-- =====================================================================
-- ERP Botica · Lógica de negocio transaccional
-- Toda operación que mueve stock o dinero pasa por estas funciones,
-- que validan permisos, bloquean filas y dejan rastro en el kardex.
-- =====================================================================

-- Exige un usuario activo con alguno de los roles indicados.
create or replace function public._exigir_rol(roles rol_usuario[]) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.tiene_rol(roles) then
    raise exception 'No tiene permisos para esta operación' using errcode = '42501';
  end if;
  return v_uid;
end $$;

create or replace function public._stock_producto(p_producto_id bigint) returns int
language sql stable set search_path = public as $$
  select coalesce(sum(stock), 0)::int from public.lotes where producto_id = p_producto_id
$$;

-- Desglosa un importe con IGV en base imponible + IGV.
create or replace function public._desglose(p_total numeric, p_afectacion afectacion_igv, p_igv_pct numeric,
  out valor numeric, out igv numeric)
language plpgsql immutable as $$
begin
  if p_afectacion = 'gravado' then
    valor := round(p_total / (1 + p_igv_pct / 100), 2);
    igv := round(p_total - valor, 2);
  else
    valor := round(p_total, 2);
    igv := 0;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Inventario
-- ---------------------------------------------------------------------
-- Ingreso de stock fuera de una compra (inventario inicial, ajuste de entrada).
create or replace function public.ingresar_stock(
  p_producto_id bigint, p_numero_lote text, p_fecha_vencimiento date,
  p_cantidad int, p_costo_unitario numeric default 0,
  p_tipo tipo_movimiento default 'inventario_inicial', p_nota text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._exigir_rol(array['admin','quimico','almacen']::rol_usuario[]);
  v_lote public.lotes;
  v_stock_prev int;
  v_costo_prev numeric;
begin
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  if p_tipo not in ('inventario_inicial','ajuste_entrada') then raise exception 'Tipo de ingreso no válido'; end if;

  perform 1 from public.productos where id = p_producto_id for update;
  if not found then raise exception 'Producto no existe'; end if;
  v_stock_prev := public._stock_producto(p_producto_id);
  select costo_promedio into v_costo_prev from public.productos where id = p_producto_id;

  insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
  values (p_producto_id, upper(trim(p_numero_lote)), p_fecha_vencimiento, p_cantidad, coalesce(p_costo_unitario, 0))
  on conflict (producto_id, numero_lote) do update
    set stock = lotes.stock + excluded.stock,
        fecha_vencimiento = excluded.fecha_vencimiento,
        costo_unitario = case when excluded.costo_unitario > 0 then excluded.costo_unitario else lotes.costo_unitario end
  returning * into v_lote;

  if coalesce(p_costo_unitario, 0) > 0 then
    update public.productos
       set costo_promedio = round(((v_stock_prev * v_costo_prev) + (p_cantidad * p_costo_unitario)) / nullif(v_stock_prev + p_cantidad, 0), 4)
     where id = p_producto_id;
  end if;

  insert into public.movimientos (producto_id, lote_id, tipo, cantidad, costo_unitario, saldo, nota, usuario_id)
  values (p_producto_id, v_lote.id, p_tipo, p_cantidad, coalesce(p_costo_unitario, 0), v_stock_prev + p_cantidad, p_nota, v_uid);

  return v_lote.id;
end $$;

-- Salida de stock por ajuste, merma o vencimiento (requiere lote).
create or replace function public.retirar_stock(
  p_lote_id bigint, p_cantidad int, p_tipo tipo_movimiento, p_nota text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._exigir_rol(array['admin','quimico','almacen']::rol_usuario[]);
  v_lote public.lotes;
begin
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  if p_tipo not in ('ajuste_salida','merma','vencimiento','devolucion_proveedor') then raise exception 'Tipo de salida no válido'; end if;
  if coalesce(trim(p_nota), '') = '' then raise exception 'Indique el motivo de la salida'; end if;

  select * into v_lote from public.lotes where id = p_lote_id for update;
  if not found then raise exception 'Lote no existe'; end if;
  if v_lote.stock < p_cantidad then raise exception 'El lote % solo tiene % unidades', v_lote.numero_lote, v_lote.stock; end if;

  update public.lotes set stock = stock - p_cantidad where id = p_lote_id;
  insert into public.movimientos (producto_id, lote_id, tipo, cantidad, costo_unitario, saldo, nota, usuario_id)
  values (v_lote.producto_id, v_lote.id, p_tipo, -p_cantidad, v_lote.costo_unitario,
          public._stock_producto(v_lote.producto_id), p_nota, v_uid);
end $$;

-- ---------------------------------------------------------------------
-- Compras
-- ---------------------------------------------------------------------
-- p: { proveedor_id, tipo_documento, serie_numero, fecha, observacion,
--      items: [{ producto_id, numero_lote, fecha_vencimiento, presentacion: 'unidad'|'empaque',
--                cantidad, costo (sin IGV, por presentación) }] }
create or replace function public.registrar_compra(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._exigir_rol(array['admin','quimico','almacen']::rol_usuario[]);
  v_igv_pct numeric;
  v_compra_id bigint;
  v_item jsonb;
  v_prod public.productos;
  v_factor int;
  v_unidades int;
  v_costo_u numeric;
  v_stock_prev int;
  v_lote public.lotes;
  v_subtotal numeric := 0;
  v_ref text;
begin
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception 'La compra no tiene productos'; end if;
  select igv_porcentaje into v_igv_pct from public.empresa where id = 1;
  v_ref := 'Compra ' || (p->>'serie_numero');

  insert into public.compras (proveedor_id, tipo_documento, serie_numero, fecha, observacion, usuario_id)
  values ((p->>'proveedor_id')::bigint, coalesce(p->>'tipo_documento', '01'), upper(trim(p->>'serie_numero')),
          coalesce((p->>'fecha')::date, current_date), p->>'observacion', v_uid)
  returning id into v_compra_id;

  for v_item in select * from jsonb_array_elements(p->'items') loop
    select * into v_prod from public.productos where id = (v_item->>'producto_id')::bigint for update;
    if not found then raise exception 'Producto % no existe', v_item->>'producto_id'; end if;
    if (v_item->>'fecha_vencimiento')::date <= current_date then
      raise exception 'El lote % de % ya está vencido', v_item->>'numero_lote', v_prod.nombre;
    end if;

    v_factor := case when v_item->>'presentacion' = 'empaque' then v_prod.unidades_por_empaque else 1 end;
    v_unidades := ((v_item->>'cantidad')::numeric * v_factor)::int;
    if v_unidades <= 0 then raise exception 'Cantidad inválida para %', v_prod.nombre; end if;
    v_costo_u := round((v_item->>'costo')::numeric / v_factor, 4);
    v_stock_prev := public._stock_producto(v_prod.id);

    insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
    values (v_prod.id, upper(trim(v_item->>'numero_lote')), (v_item->>'fecha_vencimiento')::date, v_unidades, v_costo_u)
    on conflict (producto_id, numero_lote) do update
      set costo_unitario = round(((lotes.stock * lotes.costo_unitario) + (excluded.stock * excluded.costo_unitario)) / nullif(lotes.stock + excluded.stock, 0), 4),
          stock = lotes.stock + excluded.stock,
          fecha_vencimiento = excluded.fecha_vencimiento
    returning * into v_lote;

    update public.productos
       set costo_promedio = round(((v_stock_prev * costo_promedio) + (v_unidades * v_costo_u)) / nullif(v_stock_prev + v_unidades, 0), 4)
     where id = v_prod.id;

    insert into public.compra_items (compra_id, producto_id, lote_id, numero_lote, fecha_vencimiento, cantidad, costo_unitario, total)
    values (v_compra_id, v_prod.id, v_lote.id, v_lote.numero_lote, v_lote.fecha_vencimiento, v_unidades, v_costo_u, round(v_unidades * v_costo_u, 2));

    insert into public.movimientos (producto_id, lote_id, tipo, cantidad, costo_unitario, saldo, referencia, compra_id, usuario_id)
    values (v_prod.id, v_lote.id, 'compra', v_unidades, v_costo_u, v_stock_prev + v_unidades, v_ref, v_compra_id, v_uid);

    v_subtotal := v_subtotal + round(v_unidades * v_costo_u, 2);
  end loop;

  update public.compras
     set subtotal = v_subtotal,
         igv = round(v_subtotal * v_igv_pct / 100, 2),
         total = v_subtotal + round(v_subtotal * v_igv_pct / 100, 2)
   where id = v_compra_id;

  return v_compra_id;
end $$;

-- ---------------------------------------------------------------------
-- Caja y turnos
-- ---------------------------------------------------------------------
create or replace function public.abrir_turno(p_caja_id bigint, p_monto_apertura numeric) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._exigir_rol(array['admin','quimico','cajero']::rol_usuario[]);
  v_id bigint;
begin
  if exists (select 1 from public.turnos where usuario_id = v_uid and estado = 'abierto') then
    raise exception 'Ya tiene un turno abierto';
  end if;
  if exists (select 1 from public.turnos where caja_id = p_caja_id and estado = 'abierto') then
    raise exception 'La caja ya tiene un turno abierto por otro usuario';
  end if;
  insert into public.turnos (caja_id, usuario_id, monto_apertura)
  values (p_caja_id, v_uid, greatest(coalesce(p_monto_apertura, 0), 0))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.mi_turno() returns public.turnos
language sql stable security definer set search_path = public as $$
  select * from public.turnos where usuario_id = auth.uid() and estado = 'abierto' limit 1
$$;

create or replace function public.resumen_turno(p_turno_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_turno public.turnos;
  v_por_metodo jsonb;
  v_ventas int;
  v_total numeric;
  v_ingresos numeric;
  v_egresos numeric;
  v_efectivo numeric;
  v_devoluciones numeric;
begin
  if not public.es_usuario_activo() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into v_turno from public.turnos where id = p_turno_id;
  if not found then raise exception 'Turno no existe'; end if;
  if v_turno.usuario_id <> auth.uid() and not public.tiene_rol(array['admin','quimico']::rol_usuario[]) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select count(*), coalesce(sum(total), 0) into v_ventas, v_total
    from public.ventas where turno_id = p_turno_id and not anulada and tipo <> '07';

  select coalesce(sum(total), 0) into v_devoluciones
    from public.ventas where turno_id = p_turno_id and not anulada and tipo = '07';

  select coalesce(jsonb_object_agg(metodo, monto), '{}'::jsonb) into v_por_metodo from (
    select pg.metodo, sum(case when v.tipo = '07' then -pg.monto else pg.monto end) as monto
      from public.pagos pg join public.ventas v on v.id = pg.venta_id
     where v.turno_id = p_turno_id and not v.anulada
     group by pg.metodo) t;

  select coalesce(sum(monto) filter (where tipo = 'ingreso'), 0),
         coalesce(sum(monto) filter (where tipo = 'egreso'), 0)
    into v_ingresos, v_egresos
    from public.movimientos_caja where turno_id = p_turno_id;

  v_efectivo := v_turno.monto_apertura + coalesce((v_por_metodo->>'efectivo')::numeric, 0) + v_ingresos - v_egresos;

  return jsonb_build_object(
    'turno_id', p_turno_id,
    'monto_apertura', v_turno.monto_apertura,
    'ventas', v_ventas,
    'total_ventas', v_total,
    'devoluciones', v_devoluciones,
    'neto', v_total - v_devoluciones,
    'por_metodo', v_por_metodo,
    'ingresos', v_ingresos,
    'egresos', v_egresos,
    'efectivo_esperado', round(v_efectivo, 2)
  );
end $$;

create or replace function public.movimiento_caja(p_tipo text, p_monto numeric, p_concepto text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._exigir_rol(array['admin','quimico','cajero']::rol_usuario[]);
  v_turno public.turnos;
  v_id bigint;
begin
  select * into v_turno from public.turnos where usuario_id = v_uid and estado = 'abierto';
  if not found then raise exception 'No tiene un turno abierto'; end if;
  insert into public.movimientos_caja (turno_id, tipo, monto, concepto, usuario_id)
  values (v_turno.id, p_tipo, p_monto, p_concepto, v_uid) returning id into v_id;
  return v_id;
end $$;

create or replace function public.cerrar_turno(p_turno_id bigint, p_efectivo_contado numeric, p_observacion text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._exigir_rol(array['admin','quimico','cajero']::rol_usuario[]);
  v_turno public.turnos;
  v_resumen jsonb;
begin
  select * into v_turno from public.turnos where id = p_turno_id for update;
  if not found or v_turno.estado <> 'abierto' then raise exception 'El turno no está abierto'; end if;
  if v_turno.usuario_id <> v_uid and not public.tiene_rol(array['admin']::rol_usuario[]) then
    raise exception 'Solo el titular o un administrador puede cerrar el turno';
  end if;
  v_resumen := public.resumen_turno(p_turno_id);
  update public.turnos
     set estado = 'cerrado', cerrado_at = now(),
         efectivo_esperado = (v_resumen->>'efectivo_esperado')::numeric,
         efectivo_contado = p_efectivo_contado,
         diferencia = round(p_efectivo_contado - (v_resumen->>'efectivo_esperado')::numeric, 2),
         resumen = v_resumen,
         observacion = p_observacion
   where id = p_turno_id;
  return v_resumen || jsonb_build_object('efectivo_contado', p_efectivo_contado,
    'diferencia', round(p_efectivo_contado - (v_resumen->>'efectivo_esperado')::numeric, 2));
end $$;

-- ---------------------------------------------------------------------
-- Ventas
-- ---------------------------------------------------------------------
create table public.venta_item_lotes (
  venta_item_id bigint not null references public.venta_items(id) on delete cascade,
  lote_id bigint not null references public.lotes(id),
  cantidad int not null,
  primary key (venta_item_id, lote_id)
);

-- p: {
--   tipo: '03'|'01'|'NV',
--   cliente_id?: bigint,
--   cliente?: { tipo_documento, numero_documento, nombre, direccion },
--   items: [{ producto_id, presentacion: 'unidad'|'empaque', cantidad, descuento? }],
--   pagos: [{ metodo, monto, recibido?, pos_proveedor?, numero_operacion?, marca_tarjeta?, ultimos4? }],
--   receta?: { numero, fecha_receta, paciente_nombre, paciente_documento, medico_nombre, medico_cmp, establecimiento_origen, diagnostico }
-- }
create or replace function public.registrar_venta(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._exigir_rol(array['admin','quimico','cajero']::rol_usuario[]);
  v_emp public.empresa;
  v_turno public.turnos;
  v_caja public.cajas;
  v_tipo tipo_comprobante := coalesce(p->>'tipo', '03')::tipo_comprobante;
  v_serie varchar(4);
  v_numero int;
  v_cliente public.clientes;
  v_venta_id bigint;
  v_item jsonb;
  v_prod public.productos;
  v_factor int;
  v_unidades int;
  v_cantidad numeric;
  v_precio numeric;
  v_desc numeric;
  v_total_linea numeric;
  v_d record;
  v_item_id bigint;
  v_restante int;
  v_lote record;
  v_tomar int;
  v_costo_acum numeric;
  v_requiere_receta boolean := false;
  v_retener boolean := false;
  v_receta_id bigint;
  v_pago jsonb;
  v_pagado numeric := 0;
  v_tot record;
  v_ref text;
begin
  if v_tipo not in ('01','03','NV') then raise exception 'Tipo de comprobante no válido para venta'; end if;
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception 'La venta no tiene productos'; end if;

  select * into v_emp from public.empresa where id = 1;
  select * into v_turno from public.turnos where usuario_id = v_uid and estado = 'abierto';
  if not found then raise exception 'Abra un turno de caja antes de vender'; end if;
  select * into v_caja from public.cajas where id = v_turno.caja_id;

  -- Cliente
  if p ? 'cliente' and coalesce(p->'cliente'->>'numero_documento', '') <> '' then
    insert into public.clientes (tipo_documento, numero_documento, nombre, direccion)
    values (p->'cliente'->>'tipo_documento', trim(p->'cliente'->>'numero_documento'),
            upper(trim(p->'cliente'->>'nombre')), nullif(trim(p->'cliente'->>'direccion'), ''))
    on conflict (tipo_documento, numero_documento) do update
      set nombre = excluded.nombre, direccion = coalesce(excluded.direccion, clientes.direccion)
    returning * into v_cliente;
  elsif p ? 'cliente_id' and (p->>'cliente_id') is not null then
    select * into v_cliente from public.clientes where id = (p->>'cliente_id')::bigint;
  else
    select * into v_cliente from public.clientes where tipo_documento = '0' order by id limit 1;
  end if;
  if v_cliente.id is null then raise exception 'Cliente no válido'; end if;

  if v_tipo = '01' then
    if v_cliente.tipo_documento <> '6' or length(v_cliente.numero_documento) <> 11 then
      raise exception 'La factura requiere un cliente con RUC de 11 dígitos';
    end if;
    if coalesce(v_cliente.direccion, '') = '' then raise exception 'La factura requiere la dirección fiscal del cliente'; end if;
  end if;

  -- Serie y correlativo (bloqueo de fila: sin saltos ni duplicados)
  v_serie := case v_tipo when '01' then v_caja.serie_factura when '03' then v_caja.serie_boleta else 'NV01' end;
  update public.series set correlativo = correlativo + 1
   where tipo = v_tipo and serie = v_serie returning correlativo into v_numero;
  if v_numero is null then
    insert into public.series (tipo, serie, correlativo) values (v_tipo, v_serie, 1) returning correlativo into v_numero;
  end if;
  v_ref := v_serie || '-' || lpad(v_numero::text, 8, '0');

  insert into public.ventas (turno_id, cliente_id, tipo, serie, numero, usuario_id, sunat_estado)
  values (v_turno.id, v_cliente.id, v_tipo, v_serie, v_numero, v_uid,
          case when v_tipo = 'NV' then 'no_aplica'::estado_sunat else 'pendiente'::estado_sunat end)
  returning id into v_venta_id;

  -- Ítems con asignación FEFO (primero en vencer, primero en salir)
  for v_item in select * from jsonb_array_elements(p->'items') loop
    select * into v_prod from public.productos where id = (v_item->>'producto_id')::bigint and activo;
    if not found then raise exception 'Producto % no existe o está inactivo', v_item->>'producto_id'; end if;

    v_cantidad := (v_item->>'cantidad')::numeric;
    if v_cantidad is null or v_cantidad <= 0 or v_cantidad <> trunc(v_cantidad) then
      raise exception 'Cantidad inválida para %', v_prod.nombre;
    end if;
    if v_item->>'presentacion' = 'empaque' then
      v_factor := v_prod.unidades_por_empaque;
      v_precio := v_prod.precio_empaque;
    else
      v_factor := 1;
      v_precio := v_prod.precio_unidad;
    end if;
    if v_precio <= 0 then raise exception '% no tiene precio de venta configurado', v_prod.nombre; end if;
    v_unidades := (v_cantidad * v_factor)::int;
    v_desc := round(greatest(coalesce((v_item->>'descuento')::numeric, 0), 0), 2);
    v_total_linea := round(v_cantidad * v_precio - v_desc, 2);
    if v_total_linea <= 0 then raise exception 'El descuento de % supera el importe', v_prod.nombre; end if;
    if v_desc > round(v_cantidad * v_precio * 0.30, 2) and not public.tiene_rol(array['admin','quimico']::rol_usuario[]) then
      raise exception 'Descuentos mayores al 30%% requieren autorización del químico farmacéutico';
    end if;

    if v_prod.condicion_venta <> 'libre' then v_requiere_receta := true; end if;
    if v_prod.condicion_venta in ('receta_retenida','controlado') then v_retener := true; end if;
    if v_prod.condicion_venta = 'controlado' and not public.tiene_rol(array['admin','quimico']::rol_usuario[]) then
      raise exception '% es un producto controlado: solo lo dispensa el químico farmacéutico', v_prod.nombre;
    end if;

    select * into v_d from public._desglose(v_total_linea, v_prod.afectacion_igv, v_emp.igv_porcentaje);

    insert into public.venta_items (venta_id, producto_id, descripcion, unidad, cantidad, cantidad_unidades,
      precio_unitario, valor_unitario, descuento, afectacion_igv, valor_venta, igv, total)
    values (v_venta_id, v_prod.id,
      trim(v_prod.nombre || ' ' || coalesce(v_prod.concentracion, '') ||
           case when v_factor > 1 then ' (' || coalesce(v_prod.presentacion, 'x' || v_factor) || ')' else '' end),
      case when v_factor > 1 then 'BX' else 'NIU' end,
      v_cantidad, v_unidades, v_precio,
      case when v_prod.afectacion_igv = 'gravado' then round(v_precio / (1 + v_emp.igv_porcentaje / 100), 4) else v_precio end,
      v_desc, v_prod.afectacion_igv, v_d.valor, v_d.igv, v_total_linea)
    returning id into v_item_id;

    v_restante := v_unidades;
    v_costo_acum := 0;
    for v_lote in
      select id, stock, costo_unitario from public.lotes
       where producto_id = v_prod.id and stock > 0 and fecha_vencimiento >= current_date
       order by fecha_vencimiento, id
       for update
    loop
      exit when v_restante = 0;
      v_tomar := least(v_lote.stock, v_restante);
      update public.lotes set stock = stock - v_tomar where id = v_lote.id;
      insert into public.venta_item_lotes (venta_item_id, lote_id, cantidad) values (v_item_id, v_lote.id, v_tomar);
      insert into public.movimientos (producto_id, lote_id, tipo, cantidad, costo_unitario, saldo, referencia, venta_id, usuario_id)
      values (v_prod.id, v_lote.id, 'venta', -v_tomar, v_lote.costo_unitario, public._stock_producto(v_prod.id), v_ref, v_venta_id, v_uid);
      v_costo_acum := v_costo_acum + v_tomar * v_lote.costo_unitario;
      v_restante := v_restante - v_tomar;
    end loop;

    if v_restante > 0 then
      raise exception 'Stock insuficiente de %: faltan % unidades (no se venden lotes vencidos)', v_prod.nombre, v_restante;
    end if;

    update public.venta_items
       set lote_id = (select lote_id from public.venta_item_lotes where venta_item_id = v_item_id order by cantidad desc limit 1),
           costo_unitario = round(v_costo_acum / v_unidades, 4)
     where id = v_item_id;
  end loop;

  -- Receta
  if v_requiere_receta then
    if not (p ? 'receta') or coalesce(p->'receta'->>'medico_cmp', '') = '' or coalesce(p->'receta'->>'paciente_nombre', '') = '' then
      raise exception 'La venta incluye productos con receta: registre paciente, médico y CMP';
    end if;
    insert into public.recetas (numero, fecha_receta, paciente_nombre, paciente_documento, medico_nombre, medico_cmp,
                                establecimiento_origen, diagnostico, retenida)
    values (p->'receta'->>'numero', coalesce((p->'receta'->>'fecha_receta')::date, current_date),
            upper(p->'receta'->>'paciente_nombre'), p->'receta'->>'paciente_documento',
            upper(coalesce(p->'receta'->>'medico_nombre', '')), p->'receta'->>'medico_cmp',
            p->'receta'->>'establecimiento_origen', p->'receta'->>'diagnostico', v_retener)
    returning id into v_receta_id;
  end if;

  -- Totales
  select coalesce(sum(valor_venta) filter (where afectacion_igv = 'gravado'), 0) as grav,
         coalesce(sum(valor_venta) filter (where afectacion_igv = 'exonerado'), 0) as exo,
         coalesce(sum(valor_venta) filter (where afectacion_igv = 'inafecto'), 0) as ina,
         coalesce(sum(igv), 0) as igv,
         coalesce(sum(descuento), 0) as descu,
         coalesce(sum(total), 0) as total
    into v_tot
    from public.venta_items where venta_id = v_venta_id;

  if v_tipo = '03' and v_tot.total > v_emp.monto_boleta_requiere_dni and v_cliente.tipo_documento = '0' then
    raise exception 'Boletas mayores a S/ % requieren DNI u otro documento del cliente', v_emp.monto_boleta_requiere_dni;
  end if;

  update public.ventas
     set op_gravada = v_tot.grav, op_exonerada = v_tot.exo, op_inafecta = v_tot.ina,
         igv = v_tot.igv, descuento = v_tot.descu, total = v_tot.total, receta_id = v_receta_id
   where id = v_venta_id;

  -- Pagos
  if jsonb_array_length(coalesce(p->'pagos', '[]')) = 0 then raise exception 'Registre al menos un medio de pago'; end if;
  for v_pago in select * from jsonb_array_elements(p->'pagos') loop
    if (v_pago->>'monto')::numeric <= 0 then continue; end if;
    if (v_pago->>'metodo') in ('tarjeta_debito','tarjeta_credito') and coalesce(v_pago->>'numero_operacion', '') = '' then
      raise exception 'Ingrese el número de operación del voucher del POS';
    end if;
    insert into public.pagos (venta_id, metodo, monto, recibido, vuelto, pos_proveedor, numero_operacion, marca_tarjeta, ultimos4)
    values (v_venta_id, (v_pago->>'metodo')::metodo_pago, round((v_pago->>'monto')::numeric, 2),
            nullif(v_pago->>'recibido', '')::numeric,
            case when v_pago->>'metodo' = 'efectivo' and nullif(v_pago->>'recibido', '') is not null
                 then greatest(round((v_pago->>'recibido')::numeric - (v_pago->>'monto')::numeric, 2), 0) else 0 end,
            nullif(v_pago->>'pos_proveedor', ''), nullif(v_pago->>'numero_operacion', ''),
            nullif(v_pago->>'marca_tarjeta', ''), nullif(v_pago->>'ultimos4', ''));
    v_pagado := v_pagado + round((v_pago->>'monto')::numeric, 2);
    if v_pago->>'metodo' = 'efectivo' and nullif(v_pago->>'recibido', '') is not null
       and (v_pago->>'recibido')::numeric < (v_pago->>'monto')::numeric then
      raise exception 'El efectivo recibido es menor al monto a cobrar';
    end if;
  end loop;
  if v_pagado <> v_tot.total then
    raise exception 'Los pagos (S/ %) no cuadran con el total (S/ %)', v_pagado, v_tot.total;
  end if;

  return jsonb_build_object('venta_id', v_venta_id, 'comprobante', v_ref, 'total', v_tot.total);
end $$;

-- Nota de crédito total (anulación / devolución total) con reingreso a los mismos lotes.
-- tipo_nota (catálogo 09): 01 anulación de la operación, 06 devolución total, 07 devolución por ítem.
create or replace function public.emitir_nota_credito(p_venta_id bigint, p_tipo_nota text, p_motivo text, p_metodo_devolucion metodo_pago default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._exigir_rol(array['admin','quimico']::rol_usuario[]);
  v_orig public.ventas;
  v_turno public.turnos;
  v_caja public.cajas;
  v_serie varchar(4);
  v_numero int;
  v_nc_id bigint;
  v_it record;
  v_new_item bigint;
  v_vl record;
  v_ref text;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indique el motivo de la nota de crédito'; end if;
  select * into v_orig from public.ventas where id = p_venta_id for update;
  if not found or v_orig.tipo not in ('01','03') then raise exception 'Solo se emiten notas de crédito sobre boletas o facturas'; end if;
  if v_orig.anulada then raise exception 'El comprobante ya fue anulado'; end if;
  if exists (select 1 from public.ventas where venta_referencia_id = p_venta_id and tipo = '07' and not anulada) then
    raise exception 'El comprobante ya tiene una nota de crédito';
  end if;

  select * into v_turno from public.turnos where usuario_id = v_uid and estado = 'abierto';
  if not found then raise exception 'Abra un turno de caja para registrar la devolución'; end if;
  select * into v_caja from public.cajas where id = v_turno.caja_id;

  v_serie := case v_orig.tipo when '01' then v_caja.serie_nc_factura else v_caja.serie_nc_boleta end;
  update public.series set correlativo = correlativo + 1 where tipo = '07' and serie = v_serie returning correlativo into v_numero;
  if v_numero is null then
    insert into public.series (tipo, serie, correlativo) values ('07', v_serie, 1) returning correlativo into v_numero;
  end if;
  v_ref := v_serie || '-' || lpad(v_numero::text, 8, '0');

  insert into public.ventas (turno_id, cliente_id, tipo, serie, numero, op_gravada, op_exonerada, op_inafecta, igv, descuento, total,
                             venta_referencia_id, tipo_nota, motivo_nota, usuario_id, sunat_estado)
  values (v_turno.id, v_orig.cliente_id, '07', v_serie, v_numero, v_orig.op_gravada, v_orig.op_exonerada, v_orig.op_inafecta,
          v_orig.igv, v_orig.descuento, v_orig.total, v_orig.id, p_tipo_nota, p_motivo, v_uid, 'pendiente')
  returning id into v_nc_id;

  for v_it in select * from public.venta_items where venta_id = v_orig.id loop
    insert into public.venta_items (venta_id, producto_id, lote_id, descripcion, unidad, cantidad, cantidad_unidades, precio_unitario,
                                    valor_unitario, descuento, afectacion_igv, valor_venta, igv, total, costo_unitario)
    values (v_nc_id, v_it.producto_id, v_it.lote_id, v_it.descripcion, v_it.unidad, v_it.cantidad, v_it.cantidad_unidades, v_it.precio_unitario,
            v_it.valor_unitario, v_it.descuento, v_it.afectacion_igv, v_it.valor_venta, v_it.igv, v_it.total, v_it.costo_unitario)
    returning id into v_new_item;

    for v_vl in select * from public.venta_item_lotes where venta_item_id = v_it.id loop
      update public.lotes set stock = stock + v_vl.cantidad where id = v_vl.lote_id;
      insert into public.venta_item_lotes (venta_item_id, lote_id, cantidad) values (v_new_item, v_vl.lote_id, v_vl.cantidad);
      insert into public.movimientos (producto_id, lote_id, tipo, cantidad, costo_unitario, saldo, referencia, venta_id, usuario_id)
      select v_it.producto_id, v_vl.lote_id, 'devolucion_venta', v_vl.cantidad, l.costo_unitario,
             public._stock_producto(v_it.producto_id), v_ref, v_nc_id, v_uid
        from public.lotes l where l.id = v_vl.lote_id;
    end loop;
  end loop;

  -- Devolución del dinero: por el medio indicado o, por defecto, por los mismos medios del pago original.
  if p_metodo_devolucion is not null then
    insert into public.pagos (venta_id, metodo, monto) values (v_nc_id, p_metodo_devolucion, v_orig.total);
  else
    insert into public.pagos (venta_id, metodo, monto, pos_proveedor, numero_operacion, marca_tarjeta, ultimos4)
    select v_nc_id, metodo, monto, pos_proveedor, numero_operacion, marca_tarjeta, ultimos4 from public.pagos where venta_id = v_orig.id;
  end if;

  return jsonb_build_object('venta_id', v_nc_id, 'comprobante', v_ref, 'total', v_orig.total);
end $$;

-- Anula una nota de venta interna (no electrónica) y devuelve el stock.
create or replace function public.anular_nota_venta(p_venta_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._exigir_rol(array['admin','quimico']::rol_usuario[]);
  v_v public.ventas;
  v_vl record;
begin
  select * into v_v from public.ventas where id = p_venta_id for update;
  if not found or v_v.tipo <> 'NV' then raise exception 'Solo se anulan directamente las notas de venta. Para boletas y facturas emita una nota de crédito.'; end if;
  if v_v.anulada then raise exception 'Ya está anulada'; end if;
  for v_vl in select vil.*, vi.producto_id from public.venta_item_lotes vil join public.venta_items vi on vi.id = vil.venta_item_id
               where vi.venta_id = p_venta_id loop
    update public.lotes set stock = stock + v_vl.cantidad where id = v_vl.lote_id;
    insert into public.movimientos (producto_id, lote_id, tipo, cantidad, saldo, referencia, venta_id, nota, usuario_id)
    values (v_vl.producto_id, v_vl.lote_id, 'devolucion_venta', v_vl.cantidad, public._stock_producto(v_vl.producto_id),
            v_v.serie || '-' || lpad(v_v.numero::text, 8, '0'), p_venta_id, 'Anulación: ' || p_motivo, v_uid);
  end loop;
  update public.ventas set anulada = true, motivo_anulacion = p_motivo, sunat_estado = 'no_aplica' where id = p_venta_id;
end $$;

-- ---------------------------------------------------------------------
-- Vistas operativas
-- ---------------------------------------------------------------------
create or replace view public.v_productos with (security_invoker = true) as
select p.*, l.nombre as laboratorio, c.nombre as categoria,
       s.stock, s.stock_vendible, s.proximo_vencimiento
from public.productos p
left join public.laboratorios l on l.id = p.laboratorio_id
left join public.categorias c on c.id = p.categoria_id
left join public.v_stock s on s.producto_id = p.id;

create or replace view public.v_alertas with (security_invoker = true) as
with cfg as (select dias_alerta_vencimiento as dias from public.empresa where id = 1)
select 'vencido'::text as tipo, 'alta'::text as severidad, p.id as producto_id, l.id as lote_id,
       p.nombre || ' · lote ' || l.numero_lote as titulo,
       l.stock || ' u. vencidas el ' || to_char(l.fecha_vencimiento, 'DD/MM/YYYY') || '. Retirar y registrar baja.' as detalle,
       l.fecha_vencimiento as fecha
  from public.lotes l join public.productos p on p.id = l.producto_id
 where l.stock > 0 and l.fecha_vencimiento < current_date
union all
select 'por_vencer', case when l.fecha_vencimiento < current_date + 30 then 'alta' else 'media' end, p.id, l.id,
       p.nombre || ' · lote ' || l.numero_lote,
       l.stock || ' u. vencen el ' || to_char(l.fecha_vencimiento, 'DD/MM/YYYY') || ' (' || (l.fecha_vencimiento - current_date) || ' días)',
       l.fecha_vencimiento
  from public.lotes l join public.productos p on p.id = l.producto_id, cfg
 where l.stock > 0 and l.fecha_vencimiento >= current_date and l.fecha_vencimiento <= current_date + cfg.dias
union all
select 'stock_bajo', case when coalesce(s.stock_vendible, 0) = 0 then 'alta' else 'media' end, p.id, null,
       p.nombre,
       'Stock ' || coalesce(s.stock_vendible, 0) || ' u. (mínimo ' || p.stock_minimo || ')',
       null
  from public.productos p left join public.v_stock s on s.producto_id = p.id
 where p.activo and p.stock_minimo > 0 and coalesce(s.stock_vendible, 0) <= p.stock_minimo
union all
select 'sunat_pendiente', case when v.fecha < now() - interval '2 days' then 'alta' else 'media' end, null, null,
       v.serie || '-' || lpad(v.numero::text, 8, '0'),
       'Comprobante sin aceptación de SUNAT (' || v.sunat_estado || ')',
       v.fecha::date
  from public.ventas v
 where v.sunat_estado in ('pendiente','error','rechazado','observado') and not v.anulada
union all
select 'sin_registro_sanitario', 'baja', p.id, null, p.nombre, 'Falta registro sanitario', null
  from public.productos p where p.activo and coalesce(p.registro_sanitario, '') = '' and p.categoria_id is distinct from
       (select id from public.categorias where nombre = 'Cuidado personal');

-- Libro de control de estupefacientes / psicotrópicos y recetas retenidas.
create or replace view public.v_libro_recetas with (security_invoker = true) as
select v.id as venta_id, v.fecha, v.serie || '-' || lpad(v.numero::text, 8, '0') as comprobante,
       p.nombre as producto, p.principio_activo, p.concentracion, p.condicion_venta, p.lista_control,
       vi.cantidad_unidades, l.numero_lote,
       r.numero as receta_numero, r.fecha_receta, r.paciente_nombre, r.paciente_documento,
       r.medico_nombre, r.medico_cmp, r.retenida, pf.nombre as dispensado_por
  from public.ventas v
  join public.venta_items vi on vi.venta_id = v.id
  join public.productos p on p.id = vi.producto_id
  left join public.lotes l on l.id = vi.lote_id
  left join public.recetas r on r.id = v.receta_id
  left join public.perfiles pf on pf.id = v.usuario_id
 where v.tipo <> '07' and not v.anulada and p.condicion_venta <> 'libre';

-- Datos para el Observatorio Peruano de Productos Farmacéuticos (DIGEMID).
create or replace view public.v_observatorio with (security_invoker = true) as
select p.id as producto_id, p.codigo_digemid, p.nombre, p.concentracion, p.presentacion, lab.nombre as laboratorio,
       p.unidades_por_empaque, p.precio_empaque, p.precio_unidad, s.stock
  from public.productos p
  left join public.laboratorios lab on lab.id = p.laboratorio_id
  left join public.v_stock s on s.producto_id = p.id
 where p.activo;

-- Ventas del día para el tablero
create or replace function public.tablero_hoy() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ventas_hoy', coalesce((select sum(case when tipo = '07' then -total else total end) from public.ventas
                             where fecha >= date_trunc('day', now() at time zone 'America/Lima') at time zone 'America/Lima' and not anulada), 0),
    'tickets_hoy', (select count(*) from public.ventas
                     where fecha >= date_trunc('day', now() at time zone 'America/Lima') at time zone 'America/Lima' and not anulada and tipo <> '07'),
    'pendientes_sunat', (select count(*) from public.ventas where sunat_estado in ('pendiente','error','rechazado','observado') and not anulada),
    'alertas', (select count(*) from public.v_alertas where severidad in ('alta','media')),
    'turnos_abiertos', (select count(*) from public.turnos where estado = 'abierto')
  ) where public.es_usuario_activo()
$$;

-- ---------------------------------------------------------------------
-- Seguridad (RLS)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['empresa','perfiles','laboratorios','categorias','productos','lotes','movimientos','proveedores',
                           'clientes','compras','compra_items','cajas','turnos','movimientos_caja','series','recetas',
                           'ventas','venta_items','venta_item_lotes','pagos','auditoria'] loop
    execute format('alter table public.%I enable row level security', t);
    if t <> 'auditoria' then
      execute format('create policy %I on public.%I for select to authenticated using (public.es_usuario_activo())', 'lectura_' || t, t);
    end if;
  end loop;
end $$;

create policy lectura_auditoria on public.auditoria for select to authenticated using (public.tiene_rol(array['admin']::rol_usuario[]));

-- Maestros editables por administración, químico y almacén
do $$
declare t text;
begin
  foreach t in array array['productos','laboratorios','categorias','proveedores'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check (public.tiene_rol(array[''admin'',''quimico'',''almacen'']::rol_usuario[]))', 'alta_' || t, t);
    execute format('create policy %I on public.%I for update to authenticated using (public.tiene_rol(array[''admin'',''quimico'',''almacen'']::rol_usuario[]))', 'edicion_' || t, t);
  end loop;
end $$;

create policy alta_clientes on public.clientes for insert to authenticated with check (public.es_usuario_activo());
create policy edicion_clientes on public.clientes for update to authenticated using (public.es_usuario_activo());

create policy edicion_empresa on public.empresa for update to authenticated using (public.tiene_rol(array['admin']::rol_usuario[]));
create policy alta_cajas on public.cajas for insert to authenticated with check (public.tiene_rol(array['admin']::rol_usuario[]));
create policy edicion_cajas on public.cajas for update to authenticated using (public.tiene_rol(array['admin']::rol_usuario[]));
create policy alta_series on public.series for insert to authenticated with check (public.tiene_rol(array['admin']::rol_usuario[]));
create policy edicion_series on public.series for update to authenticated using (public.tiene_rol(array['admin']::rol_usuario[]));
create policy edicion_perfiles on public.perfiles for update to authenticated using (public.tiene_rol(array['admin']::rol_usuario[]));

-- Funciones internas: no expuestas por la API
revoke execute on function public._exigir_rol(rol_usuario[]) from public, anon, authenticated;
revoke execute on function public._stock_producto(bigint) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 20261113000003_reportes.sql
-- ---------------------------------------------------------------------
-- Reportes de gestión agregados en el servidor (rápidos aunque haya miles de ventas).
create or replace function public.reporte_ventas(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ini timestamptz := (p_desde::timestamp at time zone 'America/Lima');
  v_fin timestamptz := ((p_hasta + 1)::timestamp at time zone 'America/Lima');
  r jsonb;
begin
  if not public.tiene_rol(array['admin','quimico']::rol_usuario[]) then raise exception 'No autorizado' using errcode = '42501'; end if;
  with v as (
    select *, case when tipo = '07' then -1 else 1 end as signo from public.ventas
     where fecha >= v_ini and fecha < v_fin and not anulada
  ), it as (
    select vi.*, v.signo, v.fecha from public.venta_items vi join v on v.id = vi.venta_id
  )
  select jsonb_build_object(
    'resumen', (select jsonb_build_object(
        'venta_total', coalesce(sum(signo * total), 0),
        'igv', coalesce(sum(signo * igv), 0),
        'tickets', count(*) filter (where tipo <> '07'),
        'ticket_promedio', coalesce(round(avg(total) filter (where tipo <> '07'), 2), 0),
        'devoluciones', coalesce(sum(total) filter (where tipo = '07'), 0)) from v),
    'costo', (select coalesce(round(sum(signo * cantidad_unidades * costo_unitario), 2), 0) from it),
    'base', (select coalesce(sum(signo * valor_venta), 0) from it),
    'por_dia', (select coalesce(jsonb_agg(d order by d->>'dia'), '[]') from (
        select jsonb_build_object('dia', (fecha at time zone 'America/Lima')::date, 'total', sum(signo * total), 'tickets', count(*) filter (where tipo <> '07')) d
          from v group by (fecha at time zone 'America/Lima')::date) x),
    'por_hora', (select coalesce(jsonb_agg(d order by (d->>'hora')::int), '[]') from (
        select jsonb_build_object('hora', extract(hour from fecha at time zone 'America/Lima')::int, 'total', sum(signo * total)) d
          from v group by extract(hour from fecha at time zone 'America/Lima')) x),
    'por_metodo', (select coalesce(jsonb_object_agg(metodo, monto), '{}') from (
        select pg.metodo, sum(v.signo * pg.monto) monto from public.pagos pg join v on v.id = pg.venta_id group by pg.metodo) x),
    'por_tipo', (select coalesce(jsonb_object_agg(tipo, total), '{}') from (select tipo, sum(total) total from v group by tipo) x),
    'por_usuario', (select coalesce(jsonb_agg(d), '[]') from (
        select jsonb_build_object('usuario', p.nombre, 'total', sum(v.signo * v.total), 'tickets', count(*) filter (where v.tipo <> '07')) d
          from v left join public.perfiles p on p.id = v.usuario_id group by p.nombre order by sum(v.signo * v.total) desc) x),
    'top_productos', (select coalesce(jsonb_agg(d), '[]') from (
        select jsonb_build_object('producto', pr.nombre || coalesce(' ' || pr.concentracion, ''), 'unidades', sum(it.signo * it.cantidad_unidades),
                                  'total', sum(it.signo * it.total),
                                  'utilidad', round(sum(it.signo * (it.valor_venta - it.cantidad_unidades * it.costo_unitario)), 2)) d
          from it join public.productos pr on pr.id = it.producto_id
         group by pr.id, pr.nombre, pr.concentracion order by sum(it.signo * it.total) desc limit 25) x)
  ) into r;
  return r;
end $$;

-- Valorización del inventario a la fecha
create or replace function public.valor_inventario() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'unidades', coalesce(sum(l.stock), 0),
    'valor_costo', coalesce(round(sum(l.stock * l.costo_unitario), 2), 0),
    'valor_venta', coalesce(round(sum(l.stock * p.precio_unidad), 2), 0),
    'productos', count(distinct l.producto_id)
  )
  from public.lotes l join public.productos p on p.id = l.producto_id
  where l.stock > 0 and public.tiene_rol(array['admin','quimico']::rol_usuario[])
$$;


-- ---------------------------------------------------------------------
-- 20261113000004_digemid_catalogo_fichas.sql
-- ---------------------------------------------------------------------
-- =====================================================================
-- ERP Botica · Alertas sanitarias DIGEMID, bloqueo de lotes,
-- catálogo de productos DIGEMID y fichas breves de medicamentos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Bloqueo (inmovilización) de lotes: un lote bloqueado no se vende.
-- ---------------------------------------------------------------------
alter table public.lotes add column if not exists bloqueado boolean not null default false;
alter table public.lotes add column if not exists motivo_bloqueo text;

create or replace function public.bloquear_lote(p_lote_id bigint, p_bloquear boolean, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._exigir_rol(array['admin','quimico']::rol_usuario[]);
begin
  if p_bloquear and coalesce(trim(p_motivo), '') = '' then raise exception 'Indique el motivo del bloqueo'; end if;
  update public.lotes set bloqueado = p_bloquear, motivo_bloqueo = case when p_bloquear then p_motivo else null end where id = p_lote_id;
  insert into public.auditoria (tabla, accion, registro_id, datos, usuario_id)
  values ('lotes', case when p_bloquear then 'BLOQUEO' else 'DESBLOQUEO' end, p_lote_id::text, jsonb_build_object('motivo', p_motivo), v_uid);
end $$;

-- Stock vendible excluye lotes bloqueados
create or replace view public.v_stock with (security_invoker = true) as
select p.id as producto_id,
       coalesce(sum(l.stock), 0)::int as stock,
       coalesce(sum(l.stock) filter (where l.fecha_vencimiento >= current_date and not l.bloqueado), 0)::int as stock_vendible,
       min(l.fecha_vencimiento) filter (where l.stock > 0) as proximo_vencimiento
from public.productos p
left join public.lotes l on l.producto_id = p.id
group by p.id;

-- La asignación FEFO de registrar_venta ignora lotes bloqueados
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.registrar_venta(jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def, 'where producto_id = v_prod.id and stock > 0 and fecha_vencimiento >= current_date',
                          'where producto_id = v_prod.id and stock > 0 and fecha_vencimiento >= current_date and not bloqueado');
  v_def := replace(v_def, '(no se venden lotes vencidos)', '(no se venden lotes vencidos ni bloqueados)');
  execute v_def;
end $$;

-- ---------------------------------------------------------------------
-- Alertas sanitarias (DIGEMID)
-- ---------------------------------------------------------------------
create table public.alertas_sanitarias (
  id bigint generated always as identity primary key,
  numero text,                         -- ej. "25-2025"
  fecha date,
  titulo text not null,
  descripcion text,                    -- productos, lotes, registro sanitario, motivo
  url text,
  fuente text not null default 'digemid' check (fuente in ('digemid', 'manual')),
  revisada boolean not null default false,
  revisada_por uuid references public.perfiles(id),
  revisada_at timestamptz,
  nota_revision text,
  created_at timestamptz not null default now(),
  unique (url)
);
create index idx_alertas_fecha on public.alertas_sanitarias(fecha desc nulls last, id desc);
alter table public.alertas_sanitarias enable row level security;
create policy lectura_alertas_sanitarias on public.alertas_sanitarias for select to authenticated using (public.es_usuario_activo());
create policy alta_alertas_sanitarias on public.alertas_sanitarias for insert to authenticated with check (public.tiene_rol(array['admin','quimico']::rol_usuario[]));
create policy edicion_alertas_sanitarias on public.alertas_sanitarias for update to authenticated using (public.tiene_rol(array['admin','quimico']::rol_usuario[]));

-- Normaliza texto para comparar (sin tildes, mayúsculas, espacios simples)
create or replace function public.norm(t text) returns text
language sql immutable as $$
  select regexp_replace(upper(public.unaccent(coalesce(t, ''))), '\s+', ' ', 'g')
$$;

-- Cruce de alertas con el inventario: por registro sanitario, por lote o por nombre/DCI
create or replace view public.v_alertas_coincidencias with (security_invoker = true) as
with a as (
  select id, numero, fecha, titulo, url, revisada, public.norm(titulo || ' ' || coalesce(descripcion, '')) as txt
    from public.alertas_sanitarias
)
select a.id as alerta_id, a.numero, a.fecha, a.titulo, a.url, a.revisada,
       p.id as producto_id, p.nombre as producto, l.id as lote_id, l.numero_lote, l.stock, l.bloqueado,
       case
         when l.numero_lote is not null and length(l.numero_lote) >= 4 and a.txt like '%' || public.norm(l.numero_lote) || '%' then 'lote'
         when coalesce(p.registro_sanitario, '') <> '' and a.txt like '%' || public.norm(p.registro_sanitario) || '%' then 'registro_sanitario'
         else 'nombre'
       end as coincide_por
  from a
  join public.productos p on p.activo and (
         (coalesce(p.registro_sanitario, '') <> '' and a.txt like '%' || public.norm(p.registro_sanitario) || '%')
      or (length(p.nombre) >= 5 and a.txt ~ ('(^|[^A-Z])' || public.norm(p.nombre) || '([^A-Z]|$)'))
  )
  left join public.lotes l on l.producto_id = p.id and l.stock > 0;

-- Se suman al tablero de alertas
create or replace view public.v_alertas with (security_invoker = true) as
with cfg as (select dias_alerta_vencimiento as dias from public.empresa where id = 1)
select 'alerta_digemid'::text as tipo, 'alta'::text as severidad, c.producto_id, c.lote_id,
       'DIGEMID ' || coalesce(c.numero, '') || ' · ' || c.producto || coalesce(' · lote ' || c.numero_lote, '') as titulo,
       case c.coincide_por when 'lote' then 'Coincide el N° de lote. ' when 'registro_sanitario' then 'Coincide el registro sanitario. ' else 'Coincide el nombre: verifique lote y registro. ' end
         || coalesce(c.stock || ' u. en stock', 'Sin stock') || case when c.bloqueado then ' (bloqueado)' else '' end as detalle,
       c.fecha
  from public.v_alertas_coincidencias c
 where not c.revisada
union all
select 'vencido', 'alta', p.id, l.id,
       p.nombre || ' · lote ' || l.numero_lote,
       l.stock || ' u. vencidas el ' || to_char(l.fecha_vencimiento, 'DD/MM/YYYY') || '. Retirar y registrar baja.',
       l.fecha_vencimiento
  from public.lotes l join public.productos p on p.id = l.producto_id
 where l.stock > 0 and l.fecha_vencimiento < current_date
union all
select 'por_vencer', case when l.fecha_vencimiento < current_date + 30 then 'alta' else 'media' end, p.id, l.id,
       p.nombre || ' · lote ' || l.numero_lote,
       l.stock || ' u. vencen el ' || to_char(l.fecha_vencimiento, 'DD/MM/YYYY') || ' (' || (l.fecha_vencimiento - current_date) || ' días)',
       l.fecha_vencimiento
  from public.lotes l join public.productos p on p.id = l.producto_id, cfg
 where l.stock > 0 and l.fecha_vencimiento >= current_date and l.fecha_vencimiento <= current_date + cfg.dias
union all
select 'stock_bajo', case when coalesce(s.stock_vendible, 0) = 0 then 'alta' else 'media' end, p.id, null,
       p.nombre,
       'Stock ' || coalesce(s.stock_vendible, 0) || ' u. (mínimo ' || p.stock_minimo || ')',
       null
  from public.productos p left join public.v_stock s on s.producto_id = p.id
 where p.activo and p.stock_minimo > 0 and coalesce(s.stock_vendible, 0) <= p.stock_minimo
union all
select 'sunat_pendiente', case when v.fecha < now() - interval '2 days' then 'alta' else 'media' end, null, null,
       v.serie || '-' || lpad(v.numero::text, 8, '0'),
       'Comprobante sin aceptación de SUNAT (' || v.sunat_estado || ')',
       v.fecha::date
  from public.ventas v
 where v.sunat_estado in ('pendiente','error','rechazado','observado') and not v.anulada
union all
select 'sin_registro_sanitario', 'baja', p.id, null, p.nombre, 'Falta registro sanitario', null
  from public.productos p where p.activo and coalesce(p.registro_sanitario, '') = '' and p.categoria_id is distinct from
       (select id from public.categorias where nombre = 'Cuidado personal');

-- ---------------------------------------------------------------------
-- Catálogo de productos farmacéuticos DIGEMID (referencia para el Observatorio)
-- ---------------------------------------------------------------------
create table public.catalogo_digemid (
  cod_prod varchar(20) primary key,
  nombre text not null,
  concentracion text,
  forma_farmaceutica text,
  presentacion text,
  fraccion int,
  registro_sanitario text,
  titular text,
  fabricante text,
  principio_activo text,
  situacion text,
  busqueda text generated always as (public.norm(nombre || ' ' || coalesce(principio_activo, '') || ' ' || coalesce(concentracion, ''))) stored,
  actualizado_at timestamptz not null default now()
);
create index idx_catalogo_busqueda on public.catalogo_digemid using gin (busqueda gin_trgm_ops);
create index idx_catalogo_regsan on public.catalogo_digemid(registro_sanitario);
alter table public.catalogo_digemid enable row level security;
create policy lectura_catalogo on public.catalogo_digemid for select to authenticated using (public.es_usuario_activo());
create policy alta_catalogo on public.catalogo_digemid for insert to authenticated with check (public.tiene_rol(array['admin','quimico','almacen']::rol_usuario[]));
create policy edicion_catalogo on public.catalogo_digemid for update to authenticated using (public.tiene_rol(array['admin','quimico','almacen']::rol_usuario[]));
create policy borrado_catalogo on public.catalogo_digemid for delete to authenticated using (public.tiene_rol(array['admin']::rol_usuario[]));

-- Búsqueda en el catálogo por texto libre (todas las palabras deben aparecer)
create or replace function public.buscar_catalogo(p_texto text, p_limite int default 20)
returns setof public.catalogo_digemid
language sql stable security invoker set search_path = public as $$
  select c.* from public.catalogo_digemid c
   where (select bool_and(c.busqueda like '%' || w || '%') from unnest(string_to_array(public.norm(p_texto), ' ')) w where w <> '')
   order by (c.situacion is distinct from 'ACT'), similarity(c.busqueda, public.norm(p_texto)) desc, c.nombre
   limit p_limite
$$;

-- Candidatos del catálogo para un producto propio (registro sanitario exacto primero)
create or replace function public.sugerir_codigos(p_producto_id bigint, p_limite int default 5)
returns table (cod_prod text, nombre text, concentracion text, forma_farmaceutica text, presentacion text, fraccion int,
               registro_sanitario text, titular text, puntaje real)
language sql stable security invoker set search_path = public as $$
  with p as (select * from public.productos where id = p_producto_id)
  select c.cod_prod, c.nombre, c.concentracion, c.forma_farmaceutica, c.presentacion, c.fraccion, c.registro_sanitario, c.titular,
         (case when coalesce(p.registro_sanitario, '') <> '' and public.norm(c.registro_sanitario) = public.norm(p.registro_sanitario) then 2 else 0 end
          + similarity(c.busqueda, public.norm(p.nombre || ' ' || coalesce(p.principio_activo, '') || ' ' || coalesce(p.concentracion, ''))))::real as puntaje
    from public.catalogo_digemid c, p
   where (coalesce(p.registro_sanitario, '') <> '' and public.norm(c.registro_sanitario) = public.norm(p.registro_sanitario))
      or c.busqueda % public.norm(p.nombre || ' ' || coalesce(p.concentracion, ''))
      or c.busqueda like '%' || public.norm(split_part(p.nombre, ' ', 1)) || '%' and c.busqueda like '%' || public.norm(coalesce(p.concentracion, '')) || '%'
   order by puntaje desc
   limit p_limite
$$;

-- ---------------------------------------------------------------------
-- Fichas breves de medicamentos (por principio activo)
-- ---------------------------------------------------------------------
create table public.fichas_medicamento (
  id bigint generated always as identity primary key,
  principio_activo text not null,
  clave text generated always as (public.norm(principio_activo)) stored unique,
  grupo text,                          -- grupo terapéutico
  para_que_sirve text not null,
  como_actua text,
  dosis_adulto text,
  dosis_pediatrica text,
  contraindicaciones text,
  advertencias text,
  interacciones text,
  consejo text,                        -- qué recomendar / cómo tomarlo
  updated_at timestamptz not null default now(),
  updated_by uuid references public.perfiles(id) default auth.uid()
);
create trigger trg_fichas_upd before update on public.fichas_medicamento for each row execute function set_updated_at();
alter table public.fichas_medicamento enable row level security;
create policy lectura_fichas on public.fichas_medicamento for select to authenticated using (public.es_usuario_activo());
create policy alta_fichas on public.fichas_medicamento for insert to authenticated with check (public.tiene_rol(array['admin','quimico']::rol_usuario[]));
create policy edicion_fichas on public.fichas_medicamento for update to authenticated using (public.tiene_rol(array['admin','quimico']::rol_usuario[]));
create policy borrado_fichas on public.fichas_medicamento for delete to authenticated using (public.tiene_rol(array['admin','quimico']::rol_usuario[]));

-- Fichas que corresponden a un producto (soporta combinaciones "A + B")
create or replace function public.fichas_de_producto(p_producto_id bigint)
returns setof public.fichas_medicamento
language sql stable security invoker set search_path = public as $$
  select f.* from public.productos p
   cross join lateral unnest(regexp_split_to_array(coalesce(p.principio_activo, p.nombre), '\s*(\+|/|,| y )\s*')) as comp(nombre)
   join public.fichas_medicamento f on f.clave = public.norm(trim(comp.nombre))
   where p.id = p_producto_id
$$;


-- ---------------------------------------------------------------------
-- 20261113000005_fichas_iniciales.sql
-- ---------------------------------------------------------------------
-- Fichas breves de medicamentos: información de referencia para orientar la dispensación.
-- No reemplaza la indicación médica ni el criterio del químico farmacéutico. Editables desde «Vademécum».
insert into public.fichas_medicamento (principio_activo, grupo, para_que_sirve, como_actua, dosis_adulto, dosis_pediatrica,
  contraindicaciones, advertencias, interacciones, consejo) values
('Paracetamol', 'Analgésico y antipirético', 'Dolor leve a moderado (cabeza, dental, muscular, menstrual) y fiebre.', 'Inhibe la síntesis de prostaglandinas a nivel central; casi sin efecto antiinflamatorio.', '500 mg a 1 g cada 6 a 8 h. Máximo 4 g al día (3 g en adultos mayores o consumo de alcohol).', '10 a 15 mg/kg cada 6 h. Máximo 60 mg/kg/día.', 'Insuficiencia hepática grave.', 'Riesgo de daño hepático por sobredosis o alcohol. Revisar que otros antigripales no contengan paracetamol.', 'Alcohol, warfarina (uso prolongado), isoniazida.', 'Primera opción en gestantes, niños y pacientes con gastritis. Puede tomarse con o sin alimentos.'),
('Ibuprofeno', 'AINE', 'Dolor, inflamación y fiebre: dolor dental, muscular, menstrual, articular.', 'Inhibe las enzimas COX 1 y 2 reduciendo prostaglandinas (efecto analgésico, antiinflamatorio y antipirético).', '200 a 400 mg cada 6 a 8 h. Máximo 1.2 g al día sin receta (hasta 2.4 g con indicación médica).', '5 a 10 mg/kg cada 6 a 8 h (mayores de 6 meses). Máximo 40 mg/kg/día.', 'Úlcera o sangrado digestivo, insuficiencia renal o cardiaca grave, tercer trimestre de embarazo, alergia a AINE.', 'Tomar con alimentos. Precaución en hipertensos, asmáticos y adultos mayores.', 'Anticoagulantes, otros AINE, corticoides, antihipertensivos (IECA, ARA II), diuréticos, litio.', 'Recomendar con comida y por el menor tiempo posible. Si hay gastritis, ofrecer paracetamol.'),
('Naproxeno', 'AINE', 'Dolor e inflamación: lumbalgia, dolor menstrual, artritis, esguinces.', 'Inhibidor no selectivo de COX de acción prolongada.', '250 a 550 mg cada 12 h. Máximo 1.1 g al día.', 'Mayores de 2 años: 5 mg/kg cada 12 h (bajo indicación médica).', 'Úlcera péptica, sangrado digestivo, insuficiencia renal grave, embarazo (tercer trimestre).', 'Tomar con alimentos. Mayor riesgo gastrointestinal que ibuprofeno.', 'Anticoagulantes, corticoides, antihipertensivos, litio, metotrexato.', 'Útil cuando se busca efecto prolongado (dos tomas al día).'),
('Diclofenaco', 'AINE', 'Dolor e inflamación musculoesquelética, cólico renal, dolor postoperatorio.', 'Inhibe COX 1 y 2.', '50 mg cada 8 a 12 h. Máximo 150 mg al día.', 'No recomendado en menores de 14 años sin indicación médica.', 'Úlcera o sangrado digestivo, cardiopatía isquémica, insuficiencia cardiaca, renal o hepática grave, embarazo (tercer trimestre).', 'Riesgo cardiovascular y gastrointestinal. Usar la menor dosis por el menor tiempo.', 'Anticoagulantes, AINE, corticoides, antihipertensivos, diuréticos.', 'Para dolor localizado, ofrecer también la presentación en gel.'),
('Ketorolaco', 'AINE potente', 'Dolor agudo moderado a intenso por corto plazo.', 'Inhibidor potente de COX con gran efecto analgésico.', '10 mg cada 6 a 8 h por vía oral. Máximo 40 mg al día y no más de 5 días.', 'No recomendado en menores de 16 años.', 'Úlcera, sangrado, insuficiencia renal, embarazo, lactancia, riesgo de hemorragia.', 'Solo uso corto. Alto riesgo de sangrado digestivo y daño renal.', 'Otros AINE, anticoagulantes, probenecid, litio.', 'Producto con receta: confirmar indicación y duración.'),
('Metamizol', 'Analgésico y antipirético', 'Dolor intenso (cólico, postoperatorio) y fiebre alta que no cede con otros antipiréticos.', 'Inhibición central de prostaglandinas y efecto espasmolítico.', '500 mg a 1 g cada 6 a 8 h. Máximo 4 g al día.', 'Uso bajo indicación médica: 10 a 15 mg/kg por dosis.', 'Alergia a pirazolonas, alteraciones de la médula ósea, porfiria, primer y tercer trimestre de embarazo.', 'Riesgo raro pero grave de agranulocitosis: suspender si hay fiebre con dolor de garganta o llagas.', 'Metotrexato, ciclosporina, clorpromazina.', 'Venta con receta. Advertir que consulte si aparece fiebre o dolor de garganta.'),
('Ácido acetilsalicílico', 'Antiagregante / AINE', 'Dosis bajas (81 a 100 mg): prevención cardiovascular. Dosis altas: dolor y fiebre.', 'Inhibe de forma irreversible la COX plaquetaria (antiagregante).', 'Antiagregante: 81 a 100 mg una vez al día. Analgésico: 500 mg cada 6 a 8 h.', 'No usar en menores de 16 años (riesgo de síndrome de Reye).', 'Úlcera, hemofilia, alergia a AINE, menores de 16 años, tercer trimestre de embarazo.', 'Aumenta el riesgo de sangrado. Suspender antes de cirugías según indicación médica.', 'Anticoagulantes, ibuprofeno (reduce efecto antiagregante), corticoides, metotrexato.', 'Si toma aspirina para el corazón, no cambiar por otro analgésico sin consultar.'),
('Tramadol', 'Analgésico opioide', 'Dolor moderado a intenso.', 'Agonista de receptores opioides e inhibidor de la recaptación de serotonina y noradrenalina.', '50 a 100 mg cada 6 a 8 h. Máximo 400 mg al día.', 'No recomendado en menores de 12 años.', 'Epilepsia no controlada, uso de IMAO, intoxicación alcohólica, insuficiencia respiratoria grave.', 'Produce somnolencia, náuseas y mareo. Riesgo de dependencia. No conducir.', 'Antidepresivos (síndrome serotoninérgico), benzodiacepinas, alcohol, carbamazepina.', 'Receta retenida. Advertir sobre somnolencia y no mezclar con alcohol.'),
('Amoxicilina', 'Antibiótico betalactámico', 'Infecciones bacterianas: faringoamigdalitis, otitis, sinusitis, infecciones urinarias, dentales.', 'Inhibe la síntesis de la pared bacteriana.', '500 mg cada 8 h o 875 mg cada 12 h, por 7 a 10 días según indicación.', '25 a 50 mg/kg/día divididos cada 8 a 12 h (hasta 80 a 90 mg/kg/día en otitis).', 'Alergia a penicilinas.', 'Completar el tratamiento. Puede causar diarrea o erupción.', 'Metotrexato, alopurinol (más erupciones), anticonceptivos orales (posible menor eficacia).', 'Venta con receta. Preguntar por alergia a penicilina y recalcar completar los días indicados.'),
('Amoxicilina + ácido clavulánico', 'Antibiótico betalactámico', 'Infecciones bacterianas resistentes a amoxicilina: sinusitis, otitis, mordeduras, infecciones respiratorias.', 'Amoxicilina más un inhibidor de betalactamasas.', '500/125 mg cada 8 h u 875/125 mg cada 12 h, 7 a 10 días.', '25 a 45 mg/kg/día de amoxicilina divididos cada 12 h.', 'Alergia a penicilinas, antecedente de ictericia por este fármaco.', 'Tomar al inicio de las comidas para reducir molestias digestivas.', 'Anticoagulantes orales, metotrexato, alopurinol.', 'Venta con receta. Recomendar tomarlo con alimentos.'),
('Azitromicina', 'Antibiótico macrólido', 'Infecciones respiratorias, faringitis en alérgicos a penicilina, algunas infecciones de transmisión sexual.', 'Inhibe la síntesis proteica bacteriana.', '500 mg una vez al día por 3 días (o 500 mg el día 1 y 250 mg los días 2 a 5).', '10 mg/kg una vez al día por 3 días.', 'Alergia a macrólidos, enfermedad hepática grave.', 'Puede prolongar el intervalo QT. Molestias gastrointestinales.', 'Antiácidos (separar 2 h), warfarina, fármacos que prolongan el QT.', 'Venta con receta. Una sola toma diaria, alejada de antiácidos.'),
('Ciprofloxacino', 'Antibiótico quinolona', 'Infecciones urinarias, gastrointestinales y otras bacterianas según indicación.', 'Inhibe la ADN girasa bacteriana.', '250 a 750 mg cada 12 h según la infección.', 'No recomendado en niños salvo indicación especializada.', 'Embarazo, lactancia, menores en crecimiento, antecedente de tendinitis por quinolonas.', 'Riesgo de tendinitis y rotura de tendón; fotosensibilidad.', 'Antiácidos, calcio, hierro y zinc (separar 2 h), teofilina, warfarina.', 'Venta con receta. No tomar con leche ni antiácidos.'),
('Cefalexina', 'Antibiótico cefalosporina', 'Infecciones de piel, faringe, vías urinarias y huesos.', 'Inhibe la síntesis de pared bacteriana.', '250 a 500 mg cada 6 h o 500 mg cada 12 h.', '25 a 50 mg/kg/día divididos cada 6 a 12 h.', 'Alergia a cefalosporinas; precaución en alérgicos a penicilina.', 'Diarrea, náuseas.', 'Metformina, probenecid.', 'Venta con receta.'),
('Clindamicina', 'Antibiótico lincosamida', 'Infecciones dentales, de piel y tejidos blandos, alternativa en alérgicos a penicilina.', 'Inhibe la síntesis proteica bacteriana.', '150 a 450 mg cada 6 a 8 h.', '8 a 25 mg/kg/día divididos cada 6 a 8 h.', 'Alergia a lincosamidas, antecedente de colitis por antibióticos.', 'Riesgo de diarrea por Clostridioides difficile: consultar si hay diarrea intensa.', 'Bloqueantes neuromusculares, eritromicina.', 'Venta con receta. Tomar con un vaso de agua completo.'),
('Metronidazol', 'Antiparasitario y antibiótico', 'Amebiasis, giardiasis, tricomoniasis, vaginosis bacteriana, infecciones por anaerobios.', 'Daña el ADN de parásitos y bacterias anaerobias.', '250 a 500 mg cada 8 h; dosis y duración según la infección.', '15 a 35 mg/kg/día divididos cada 8 h.', 'Primer trimestre de embarazo, consumo de alcohol.', 'Sabor metálico. No tomar alcohol durante y hasta 3 días después (efecto antabús).', 'Alcohol, warfarina, litio.', 'Advertir de forma explícita: nada de alcohol durante el tratamiento.'),
('Nitrofurantoína', 'Antibiótico urinario', 'Infección urinaria baja no complicada.', 'Daña el ADN bacteriano en la orina.', '100 mg cada 12 h (liberación prolongada) por 5 días.', '5 a 7 mg/kg/día divididos cada 6 h.', 'Insuficiencia renal, embarazo a término, lactantes menores de 1 mes.', 'Puede teñir la orina de color oscuro. Tomar con alimentos.', 'Antiácidos con magnesio.', 'Venta con receta. Recomendar tomar abundante agua.'),
('Fluconazol', 'Antifúngico', 'Candidiasis vaginal, oral y esofágica; algunas micosis.', 'Inhibe la síntesis de ergosterol del hongo.', 'Candidiasis vaginal: 150 mg dosis única.', '3 a 6 mg/kg una vez al día según indicación.', 'Alergia a azoles, uso de fármacos que prolongan el QT como cisaprida.', 'Precaución en enfermedad hepática.', 'Warfarina, estatinas, sulfonilureas, fenitoína.', 'Para candidiasis vaginal suele bastar una dosis; si se repite con frecuencia, derivar al médico.'),
('Clotrimazol', 'Antifúngico tópico', 'Hongos de la piel (pie de atleta, tiña), candidiasis cutánea y vaginal.', 'Altera la membrana celular del hongo.', 'Crema: aplicar 2 a 3 veces al día por 2 a 4 semanas. Óvulo vaginal según presentación.', 'Crema: igual que adultos.', 'Alergia al componente.', 'Continuar 1 a 2 semanas después de que desaparezcan los síntomas.', 'Puede dañar preservativos de látex (presentación vaginal).', 'Mantener la zona limpia y seca; usar medias de algodón.'),
('Albendazol', 'Antiparasitario', 'Parásitos intestinales (oxiuros, áscaris, uncinarias, tricocéfalos).', 'Bloquea la captación de glucosa del parásito.', '400 mg dosis única (repetir a las 2 semanas en oxiuros).', 'Mayores de 2 años: 400 mg dosis única. De 1 a 2 años: 200 mg.', 'Embarazo, alergia a benzimidazoles.', 'Tratar a toda la familia en caso de oxiuros.', 'Cimetidina, dexametasona.', 'Recomendar lavado de manos, uñas cortas y lavar ropa de cama.'),
('Mebendazol', 'Antiparasitario', 'Parásitos intestinales.', 'Inhibe la captación de glucosa del parásito.', '100 mg cada 12 h por 3 días o 500 mg dosis única.', 'Mayores de 2 años: igual que adultos.', 'Embarazo, menores de 1 año.', 'Puede causar dolor abdominal leve.', 'Metronidazol (evitar asociación), cimetidina.', 'Desparasitar a la familia y reforzar medidas de higiene.'),
('Loratadina', 'Antihistamínico', 'Rinitis alérgica, urticaria y picazón alérgica.', 'Bloquea receptores H1 periféricos; poco sedante.', '10 mg una vez al día.', '2 a 12 años: menos de 30 kg 5 mg; más de 30 kg 10 mg una vez al día.', 'Alergia a loratadina.', 'Puede causar somnolencia leve en algunas personas.', 'Ketoconazol, eritromicina, cimetidina.', 'Buena opción de día porque casi no da sueño.'),
('Cetirizina', 'Antihistamínico', 'Rinitis alérgica, urticaria y conjuntivitis alérgica.', 'Bloquea receptores H1.', '10 mg una vez al día.', '2 a 6 años: 2.5 mg cada 12 h. De 6 a 12 años: 5 mg cada 12 h.', 'Insuficiencia renal grave sin ajuste de dosis.', 'Puede dar somnolencia: mejor por la noche.', 'Alcohol y otros depresores del sistema nervioso.', 'Recomendar tomarla de noche si da sueño.'),
('Clorfenamina', 'Antihistamínico sedante', 'Alergias, picazón, rinitis; componente de antigripales.', 'Bloquea receptores H1 con efecto sedante.', '4 mg cada 4 a 6 h. Máximo 24 mg al día.', '2 a 6 años: 1 mg cada 4 a 6 h. De 6 a 12 años: 2 mg cada 4 a 6 h.', 'Glaucoma, retención urinaria, recién nacidos.', 'Produce sueño: no conducir. Precaución en adultos mayores.', 'Alcohol, benzodiacepinas, antidepresivos.', 'Advertir sobre la somnolencia.'),
('Desloratadina', 'Antihistamínico', 'Rinitis alérgica y urticaria.', 'Bloquea receptores H1; no sedante.', '5 mg una vez al día.', '1 a 5 años: 1.25 mg; de 6 a 11 años: 2.5 mg una vez al día.', 'Alergia al componente.', 'Bien tolerada.', 'Pocas interacciones relevantes.', 'Alternativa sin sueño para uso diario.'),
('Omeprazol', 'Inhibidor de bomba de protones', 'Acidez, reflujo, gastritis, úlcera; protección gástrica con AINE.', 'Bloquea la bomba de protones de la célula gástrica, reduciendo el ácido.', '20 mg una vez al día en ayunas (hasta 40 mg según indicación).', 'Según peso: 10 a 20 mg al día bajo indicación médica.', 'Alergia a benzimidazoles, uso con nelfinavir.', 'Uso prolongado: déficit de B12 y magnesio, mayor riesgo de fracturas.', 'Clopidogrel (reduce su efecto), metotrexato, ketoconazol.', 'Tomar 30 minutos antes del desayuno.'),
('Esomeprazol', 'Inhibidor de bomba de protones', 'Reflujo, gastritis, úlcera.', 'Bloquea la bomba de protones.', '20 a 40 mg una vez al día en ayunas.', 'Según indicación médica.', 'Alergia al componente.', 'Igual que omeprazol.', 'Clopidogrel, metotrexato.', 'Tomar 30 minutos antes del desayuno.'),
('Ranitidina', 'Antagonista H2', 'Acidez y gastritis (retirada del mercado en varios países por impurezas).', 'Bloquea los receptores H2 de histamina en el estómago.', '150 mg cada 12 h.', '2 a 4 mg/kg/día.', 'Alergia al componente.', 'Verificar disponibilidad y alertas sanitarias vigentes.', 'Ketoconazol.', 'Preferir alternativas disponibles.'),
('Hidróxido de aluminio + hidróxido de magnesio', 'Antiácido', 'Acidez y ardor estomacal ocasional.', 'Neutraliza el ácido del estómago.', '10 a 20 mL o 1 a 2 tabletas 1 h después de comidas y al acostarse.', 'Según indicación médica.', 'Insuficiencia renal grave.', 'Separar 2 h de otros medicamentos.', 'Reduce la absorción de antibióticos (quinolonas, tetraciclinas), hierro y levotiroxina.', 'Si la acidez dura más de 2 semanas, derivar al médico.'),
('Bicarbonato de sodio', 'Antiácido', 'Acidez e indigestión ocasional.', 'Neutraliza el ácido gástrico.', '1 sobre disuelto en agua después de las comidas, hasta 3 veces al día.', 'No recomendado en menores de 12 años sin indicación.', 'Hipertensión no controlada, dieta baja en sodio, insuficiencia renal.', 'Alto contenido de sodio. Uso ocasional.', 'Separar de otros medicamentos.', 'Solo para molestias ocasionales.'),
('Loperamida', 'Antidiarreico', 'Diarrea aguda sin fiebre ni sangre.', 'Reduce el movimiento intestinal actuando en receptores opioides del intestino.', '4 mg al inicio y luego 2 mg tras cada deposición líquida. Máximo 8 mg al día sin receta.', 'No usar en menores de 6 años.', 'Diarrea con sangre o fiebre alta, colitis, menores de 2 años.', 'Suspender si no mejora en 48 h.', 'Ketoconazol, ritonavir.', 'Recomendar siempre suero de rehidratación oral.'),
('Sales de rehidratación oral', 'Rehidratante', 'Prevenir y tratar la deshidratación por diarrea o vómitos.', 'Repone agua y electrolitos (sodio, potasio, glucosa).', 'Beber a demanda; 200 a 400 mL después de cada deposición.', 'Menores de 2 años: 50 a 100 mL tras cada deposición; de 2 a 10 años: 100 a 200 mL.', 'Vómitos incoercibles, obstrucción intestinal.', 'Preparar con agua segura y usar dentro de 24 h.', 'Ninguna relevante.', 'Producto clave en diarrea infantil: ofrecerlo siempre.'),
('Simeticona', 'Antiflatulento', 'Gases, distensión y cólico del lactante.', 'Rompe las burbujas de gas en el intestino.', '40 a 125 mg después de comidas y al acostarse.', 'Lactantes: 20 mg (gotas) tras cada toma.', 'Alergia al componente.', 'Muy segura; no se absorbe.', 'Levotiroxina (separar).', 'Útil para cólicos del bebé.'),
('Butilescopolamina', 'Antiespasmódico', 'Cólicos abdominales, menstruales y biliares.', 'Relaja el músculo liso intestinal (anticolinérgico).', '10 a 20 mg cada 6 a 8 h. Máximo 100 mg al día.', 'Mayores de 6 años: 10 mg cada 8 h.', 'Glaucoma, megacolon, miastenia gravis, retención urinaria.', 'Sequedad de boca, visión borrosa.', 'Antihistamínicos, antidepresivos tricíclicos.', 'Para cólico menstrual puede combinarse con un analgésico.'),
('Metoclopramida', 'Antiemético', 'Náuseas y vómitos.', 'Bloquea receptores de dopamina y acelera el vaciamiento gástrico.', '10 mg hasta 3 veces al día, máximo 5 días.', 'No recomendado en menores de 1 año; en niños solo con indicación médica.', 'Hemorragia u obstrucción digestiva, epilepsia, feocromocitoma.', 'Riesgo de movimientos involuntarios, sobre todo en jóvenes.', 'Levodopa, antipsicóticos, alcohol.', 'Venta con receta. Uso corto.'),
('Dimenhidrinato', 'Antiemético antihistamínico', 'Mareo por movimiento (viajes), náuseas y vértigo.', 'Antihistamínico H1 con acción sobre el centro del vómito.', '50 a 100 mg cada 4 a 6 h. Tomar 30 minutos antes del viaje.', '2 a 6 años: 12.5 a 25 mg; de 6 a 12 años: 25 a 50 mg cada 6 a 8 h.', 'Glaucoma, retención urinaria, menores de 2 años.', 'Produce sueño: no conducir.', 'Alcohol, sedantes.', 'Tomar media hora antes de viajar.'),
('Bisacodilo', 'Laxante estimulante', 'Estreñimiento ocasional.', 'Estimula el movimiento del colon.', '5 a 10 mg en la noche.', 'Mayores de 6 años: 5 mg.', 'Obstrucción intestinal, apendicitis, deshidratación.', 'Uso ocasional; el uso crónico puede causar dependencia.', 'Antiácidos y leche (tomar separado).', 'Recomendar fibra y agua; actúa en 6 a 12 h.'),
('Lactulosa', 'Laxante osmótico', 'Estreñimiento, incluido en niños y gestantes; encefalopatía hepática.', 'Retiene agua en el colon y ablanda las heces.', '15 a 30 mL al día.', '1 a 6 años: 5 a 10 mL; de 7 a 14 años: 10 a 15 mL al día.', 'Galactosemia, obstrucción intestinal.', 'Puede causar gases al inicio.', 'Ninguna relevante.', 'Efecto en 24 a 48 h.'),
('Salbutamol', 'Broncodilatador', 'Crisis de asma y broncoespasmo.', 'Agonista beta 2 que relaja los bronquios.', 'Inhalador: 1 a 2 puffs (100 a 200 mcg) cada 4 a 6 h según necesidad.', 'Inhalador con aerocámara: 1 a 2 puffs según necesidad.', 'Alergia al componente.', 'Temblor y palpitaciones. Si necesita más de lo habitual, acudir al médico.', 'Betabloqueantes, diuréticos (bajo potasio).', 'Enseñar la técnica del inhalador y recomendar aerocámara.'),
('Budesonida', 'Corticoide inhalado / nasal', 'Control del asma; rinitis alérgica (nasal).', 'Reduce la inflamación de la vía aérea.', 'Inhalado: 200 a 400 mcg cada 12 h. Nasal: 1 a 2 aplicaciones por fosa al día.', 'Según indicación médica.', 'Infección respiratoria no tratada.', 'Enjuagar la boca tras inhalar para evitar hongos.', 'Ketoconazol, ritonavir.', 'Es tratamiento de control diario, no de rescate.'),
('Ambroxol', 'Mucolítico', 'Tos con flema (productiva).', 'Fluidifica el moco y facilita su expulsión.', '30 mg cada 8 a 12 h.', '2 a 5 años: 7.5 mg cada 8 h; de 6 a 12 años: 15 mg cada 8 h.', 'Alergia al componente, úlcera activa.', 'No combinar con antitusivos.', 'Antitusivos.', 'Recomendar abundante agua.'),
('Acetilcisteína', 'Mucolítico', 'Tos con flema espesa.', 'Rompe los enlaces del moco.', '600 mg una vez al día o 200 mg cada 8 h.', '2 a 7 años: 100 mg cada 8 a 12 h.', 'Menores de 2 años, úlcera activa.', 'Olor azufrado característico.', 'Antitusivos, algunos antibióticos (separar 2 h).', 'Recomendar abundante agua.'),
('Dextrometorfano', 'Antitusivo', 'Tos seca irritativa.', 'Suprime el reflejo de la tos a nivel central.', '10 a 20 mg cada 4 h o 30 mg cada 6 a 8 h. Máximo 120 mg al día.', 'No recomendado en menores de 6 años; de 6 a 12 años: 5 a 10 mg cada 4 h.', 'Uso de IMAO, tos con flema, asma.', 'Puede causar somnolencia.', 'IMAO, antidepresivos (síndrome serotoninérgico).', 'Solo para tos seca; si hay flema, ofrecer mucolítico.'),
('Fenilefrina', 'Descongestionante', 'Congestión nasal; componente de antigripales.', 'Vasoconstrictor alfa adrenérgico.', '10 mg cada 4 a 6 h.', 'Según presentación pediátrica.', 'Hipertensión no controlada, cardiopatía, uso de IMAO, hipertiroidismo.', 'Puede elevar la presión arterial.', 'IMAO, betabloqueantes, antidepresivos.', 'Preguntar si es hipertenso antes de recomendar antigripales.'),
('Oximetazolina', 'Descongestionante nasal', 'Congestión nasal por resfrío o sinusitis.', 'Vasoconstrictor tópico nasal.', '1 a 2 aplicaciones por fosa cada 12 h. Máximo 3 a 5 días.', 'Mayores de 6 años: presentación pediátrica.', 'Rinitis atrófica, menores de 2 años.', 'Más de 5 días produce efecto rebote.', 'IMAO.', 'Advertir: no usar más de 5 días seguidos.'),
('Losartán', 'Antihipertensivo (ARA II)', 'Hipertensión arterial, protección renal en diabéticos, insuficiencia cardiaca.', 'Bloquea el receptor de angiotensina II y relaja los vasos.', '50 mg una vez al día (25 a 100 mg).', 'Según indicación médica.', 'Embarazo, uso con aliskireno en diabéticos.', 'Controlar potasio y función renal. Puede causar mareo al inicio.', 'AINE, diuréticos ahorradores de potasio, suplementos de potasio, litio.', 'Tomar todos los días a la misma hora aunque se sienta bien.'),
('Enalapril', 'Antihipertensivo (IECA)', 'Hipertensión arterial e insuficiencia cardiaca.', 'Inhibe la enzima convertidora de angiotensina.', '5 a 20 mg una o dos veces al día.', 'Según indicación médica.', 'Embarazo, antecedente de angioedema.', 'Puede causar tos seca persistente.', 'AINE, diuréticos ahorradores de potasio, litio.', 'Si presenta tos seca persistente, consultar al médico.'),
('Amlodipino', 'Antihipertensivo (calcioantagonista)', 'Hipertensión arterial y angina.', 'Bloquea canales de calcio y relaja las arterias.', '5 a 10 mg una vez al día.', 'Según indicación médica.', 'Hipotensión grave, shock.', 'Puede causar hinchazón de tobillos.', 'Simvastatina (dosis alta), jugo de toronja.', 'Tomar a la misma hora cada día.'),
('Metformina', 'Antidiabético oral', 'Diabetes tipo 2.', 'Reduce la producción de glucosa en el hígado y mejora la sensibilidad a la insulina.', '500 a 850 mg dos a tres veces al día con comidas. Máximo 2.5 g al día.', 'Mayores de 10 años bajo indicación médica.', 'Insuficiencia renal grave, acidosis, alcoholismo.', 'Tomar con alimentos. Molestias digestivas al inicio.', 'Alcohol, contrastes yodados (suspender temporalmente).', 'Recomendar tomar con las comidas.'),
('Glibenclamida', 'Antidiabético oral (sulfonilurea)', 'Diabetes tipo 2.', 'Estimula la liberación de insulina.', '2.5 a 5 mg con el desayuno (hasta 15 mg al día).', 'No indicada en niños.', 'Diabetes tipo 1, insuficiencia renal o hepática grave, embarazo.', 'Riesgo de hipoglucemia: no saltarse comidas.', 'Alcohol, betabloqueantes, fluconazol.', 'Explicar los signos de hipoglucemia (sudor, temblor) y llevar azúcar.'),
('Atorvastatina', 'Hipolipemiante (estatina)', 'Colesterol alto y prevención cardiovascular.', 'Inhibe la síntesis de colesterol en el hígado.', '10 a 80 mg una vez al día.', 'Según indicación médica.', 'Enfermedad hepática activa, embarazo, lactancia.', 'Consultar si aparece dolor muscular inexplicable.', 'Claritromicina, antifúngicos azoles, jugo de toronja.', 'Puede tomarse a cualquier hora, siempre la misma.'),
('Levotiroxina', 'Hormona tiroidea', 'Hipotiroidismo.', 'Reemplaza la hormona tiroidea.', 'Dosis individual (25 a 200 mcg al día).', 'Según peso y edad, bajo indicación médica.', 'Tirotoxicosis no tratada, infarto reciente.', 'Tomar en ayunas, 30 a 60 minutos antes del desayuno.', 'Calcio, hierro, antiácidos, omeprazol (separar 4 h).', 'No cambiar de marca sin control médico.'),
('Prednisona', 'Corticoide', 'Inflamación y alergia graves, asma, enfermedades autoinmunes.', 'Potente efecto antiinflamatorio e inmunosupresor.', '5 a 60 mg al día según indicación, idealmente en la mañana.', '1 a 2 mg/kg/día según indicación.', 'Infección no controlada, úlcera activa.', 'No suspender bruscamente tras uso prolongado. Eleva la glucosa.', 'AINE, antidiabéticos, diuréticos.', 'Venta con receta. Tomar en la mañana con alimentos.'),
('Dexametasona', 'Corticoide', 'Inflamación y alergia graves, edema.', 'Corticoide de alta potencia.', '0.5 a 9 mg al día según indicación.', 'Según indicación médica.', 'Infección no controlada.', 'Igual que prednisona.', 'AINE, antidiabéticos, anticoagulantes.', 'Venta con receta.'),
('Clonazepam', 'Benzodiacepina', 'Ansiedad, trastorno de pánico, epilepsia.', 'Potencia el efecto inhibidor del GABA.', '0.25 a 2 mg al día según indicación.', 'Epilepsia infantil bajo indicación especializada.', 'Insuficiencia respiratoria grave, apnea del sueño, miastenia gravis, glaucoma de ángulo cerrado.', 'Produce dependencia y somnolencia. No suspender de golpe.', 'Alcohol, opioides, antidepresivos, antihistamínicos sedantes.', 'Controlado: dispensar solo con receta especial, registrar y retener.'),
('Alprazolam', 'Benzodiacepina', 'Ansiedad y trastorno de pánico.', 'Potencia el efecto del GABA.', '0.25 a 0.5 mg dos a tres veces al día.', 'No indicado en niños.', 'Miastenia gravis, insuficiencia respiratoria grave.', 'Dependencia, somnolencia.', 'Alcohol, opioides, ketoconazol.', 'Controlado: receta especial.'),
('Sertralina', 'Antidepresivo (ISRS)', 'Depresión, ansiedad, trastorno obsesivo compulsivo.', 'Inhibe la recaptación de serotonina.', '50 mg al día (hasta 200 mg).', 'Según indicación especializada.', 'Uso de IMAO o pimozida.', 'El efecto tarda 2 a 4 semanas. No suspender bruscamente.', 'Tramadol, triptanes, otros antidepresivos, AINE (sangrado).', 'Venta con receta. Explicar que el efecto no es inmediato.'),
('Vitamina C', 'Vitamina', 'Suplemento en déficit; apoyo en resfríos.', 'Antioxidante; participa en la síntesis de colágeno y la absorción de hierro.', '500 mg a 1 g al día.', 'Según edad: 15 a 75 mg al día.', 'Cálculos renales de oxalato.', 'Dosis altas pueden causar diarrea.', 'Mejora la absorción del hierro.', 'Puede tomarse junto con el sulfato ferroso para mejorar su absorción.'),
('Sulfato ferroso', 'Antianémico', 'Prevención y tratamiento de anemia por falta de hierro.', 'Repone el hierro para formar hemoglobina.', '60 a 120 mg de hierro elemental al día.', '3 a 6 mg/kg/día de hierro elemental.', 'Hemocromatosis, anemias no ferropénicas.', 'Heces oscuras y estreñimiento. Mejor en ayunas o con jugo cítrico.', 'Antiácidos, calcio, leche, té, café, tetraciclinas, quinolonas.', 'No tomar con leche ni té; mejor con jugo de naranja.'),
('Ácido fólico', 'Vitamina', 'Prevención de defectos del tubo neural en el embarazo; anemia megaloblástica.', 'Necesario para la síntesis de ADN.', 'Embarazo: 0.4 a 1 mg al día. Anemia: 1 a 5 mg al día.', 'Según indicación médica.', 'Anemia por déficit de B12 sin tratar.', 'Iniciar idealmente antes del embarazo.', 'Fenitoína, metotrexato.', 'Recomendar a mujeres que planean embarazo.'),
('Complejo B', 'Vitaminas', 'Déficit de vitaminas del complejo B, neuropatías, convalecencia.', 'Coenzimas del metabolismo energético y nervioso.', '1 tableta al día.', 'Según presentación.', 'Alergia a los componentes.', 'Puede teñir la orina de amarillo.', 'Levodopa (vitamina B6).', 'Es normal que la orina se ponga amarilla.'),
('Insulina humana NPH', 'Insulina de acción intermedia', 'Diabetes tipo 1 y tipo 2 que requiere insulina.', 'Permite el ingreso de glucosa a las células.', 'Dosis individual por médico.', 'Dosis individual por médico.', 'Hipoglucemia.', 'Riesgo de hipoglucemia. Rotar el sitio de aplicación.', 'Betabloqueantes (enmascaran la hipoglucemia), alcohol, corticoides.', 'Cadena de frío: refrigerar de 2 a 8 °C, nunca congelar. El frasco en uso dura 28 días a temperatura ambiente.'),
('Levonorgestrel', 'Anticonceptivo de emergencia', 'Anticoncepción de emergencia tras una relación sin protección.', 'Retrasa o inhibe la ovulación.', '1.5 mg dosis única lo antes posible, dentro de las 72 h.', 'No aplica.', 'Embarazo confirmado.', 'No es un método anticonceptivo regular. Si vomita en las 3 h siguientes, repetir.', 'Rifampicina, carbamazepina, efavirenz (reducen su eficacia).', 'Más eficaz cuanto antes se tome. Orientar sobre métodos regulares.'),
('Sildenafilo', 'Inhibidor de la PDE5', 'Disfunción eréctil; hipertensión pulmonar.', 'Aumenta el flujo sanguíneo al inhibir la fosfodiesterasa 5.', '50 mg 1 h antes de la actividad sexual (25 a 100 mg). Máximo 1 dosis al día.', 'No aplica.', 'Uso de nitratos (riesgo de hipotensión grave), cardiopatía grave.', 'Dolor de cabeza, rubor. Acudir al médico si la erección dura más de 4 h.', 'Nitratos, alfabloqueantes, ritonavir.', 'Venta con receta. Preguntar si usa nitratos para el corazón.'),
('Tamsulosina', 'Alfabloqueante', 'Síntomas urinarios por hiperplasia benigna de próstata.', 'Relaja el músculo liso de la próstata y el cuello vesical.', '0.4 mg una vez al día después de la misma comida.', 'No aplica.', 'Hipotensión ortostática.', 'Mareo al levantarse.', 'Otros alfabloqueantes, sildenafilo.', 'Levantarse despacio.'),
('Ivermectina', 'Antiparasitario', 'Escabiosis, piojos y algunos parásitos intestinales según indicación.', 'Paraliza al parásito.', '150 a 200 mcg/kg dosis única (repetir según indicación).', 'Mayores de 15 kg bajo indicación médica.', 'Embarazo, menores de 15 kg.', 'Tomar en ayunas con agua.', 'Warfarina.', 'Venta con receta. En escabiosis, tratar a los convivientes.'),
('Permetrina', 'Antiparasitario tópico', 'Escabiosis (sarna) y piojos.', 'Neurotóxico para el parásito.', 'Escabiosis: crema al 5 % de cuello a pies por 8 a 12 h y luego enjuagar; repetir a los 7 días.', 'Mayores de 2 meses: igual técnica.', 'Alergia a piretroides.', 'Picazón puede persistir unas semanas.', 'Ninguna relevante.', 'Lavar ropa y sábanas con agua caliente.'),
('Aciclovir', 'Antiviral', 'Herpes labial, genital y herpes zóster.', 'Inhibe la replicación del virus herpes.', 'Herpes labial tópico: 5 veces al día por 5 días. Oral: 200 a 800 mg 5 veces al día según indicación.', 'Según peso, bajo indicación médica.', 'Alergia al componente.', 'Iniciar al primer síntoma (hormigueo).', 'Probenecid.', 'La crema funciona mejor si se aplica desde el primer hormigueo.'),
('Hioscina + metamizol', 'Antiespasmódico con analgésico', 'Cólico abdominal y menstrual intenso.', 'Combina relajación del músculo liso con analgesia.', '1 tableta cada 6 a 8 h.', 'Según indicación médica.', 'Las de cada componente.', 'Ver advertencias de metamizol.', 'Ver componentes.', 'Venta con receta.')
on conflict (clave) do nothing;


-- ---------------------------------------------------------------------
-- 20261113000006_anulacion_conteo.sql
-- ---------------------------------------------------------------------
-- =====================================================================
-- Etapa 2: anulación de comprobantes ante SUNAT e inventario físico
-- =====================================================================

-- ---------------------------------------------------------------------
-- Anulación (comunicación de baja / resumen diario) de boletas y facturas.
-- La llama /api/sunat/anular DESPUÉS de que el proveedor confirma la baja.
-- Un comprobante rechazado por SUNAT no tiene validez: se anula solo en el sistema.
-- ---------------------------------------------------------------------
create or replace function public.anular_comprobante(p_venta_id bigint, p_motivo text, p_estado_sunat estado_sunat default 'anulado')
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._exigir_rol(array['admin','quimico']::rol_usuario[]);
  v_v public.ventas;
  v_vl record;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indique el motivo de la anulación'; end if;
  select * into v_v from public.ventas where id = p_venta_id for update;
  if not found then raise exception 'Comprobante no existe'; end if;
  if v_v.tipo not in ('01', '03') then raise exception 'Solo se anulan boletas y facturas por esta vía'; end if;
  if v_v.anulada then raise exception 'El comprobante ya está anulado'; end if;
  if exists (select 1 from public.ventas where venta_referencia_id = p_venta_id and tipo = '07' and not anulada) then
    raise exception 'El comprobante tiene una nota de crédito: no se puede anular';
  end if;
  if v_v.fecha < now() - interval '7 days' and v_v.sunat_estado <> 'rechazado' then
    raise exception 'Pasaron más de 7 días desde la emisión: emita una nota de crédito';
  end if;

  for v_vl in select vil.*, vi.producto_id from public.venta_item_lotes vil join public.venta_items vi on vi.id = vil.venta_item_id
               where vi.venta_id = p_venta_id loop
    update public.lotes set stock = stock + v_vl.cantidad where id = v_vl.lote_id;
    insert into public.movimientos (producto_id, lote_id, tipo, cantidad, saldo, referencia, venta_id, nota, usuario_id)
    values (v_vl.producto_id, v_vl.lote_id, 'devolucion_venta', v_vl.cantidad, public._stock_producto(v_vl.producto_id),
            v_v.serie || '-' || lpad(v_v.numero::text, 8, '0'), p_venta_id, 'Anulación: ' || p_motivo, v_uid);
  end loop;
  update public.ventas set anulada = true, motivo_anulacion = p_motivo, sunat_estado = p_estado_sunat where id = p_venta_id;
end $$;
revoke execute on function public.anular_comprobante(bigint, text, estado_sunat) from public, anon;

-- ---------------------------------------------------------------------
-- Inventario físico (toma de inventario por lote)
-- ---------------------------------------------------------------------
create table public.conteos (
  id bigint generated always as identity primary key,
  descripcion text not null,
  estado text not null default 'abierto' check (estado in ('abierto', 'cerrado', 'anulado')),
  usuario_id uuid references public.perfiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  cerrado_por uuid references public.perfiles(id),
  cerrado_at timestamptz
);
create table public.conteo_items (
  id bigint generated always as identity primary key,
  conteo_id bigint not null references public.conteos(id) on delete cascade,
  producto_id bigint not null references public.productos(id),
  lote_id bigint not null references public.lotes(id),
  stock_sistema int not null,        -- stock del lote cuando se contó
  contado int not null check (contado >= 0),
  usuario_id uuid references public.perfiles(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (conteo_id, lote_id)
);
create index idx_conteo_items on public.conteo_items(conteo_id);

alter table public.conteos enable row level security;
alter table public.conteo_items enable row level security;
create policy lectura_conteos on public.conteos for select to authenticated using (public.es_usuario_activo());
create policy lectura_conteo_items on public.conteo_items for select to authenticated using (public.es_usuario_activo());

create or replace function public.crear_conteo(p_descripcion text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._exigir_rol(array['admin','quimico','almacen']::rol_usuario[]); v_id bigint;
begin
  insert into public.conteos (descripcion, usuario_id) values (coalesce(nullif(trim(p_descripcion), ''), 'Inventario ' || to_char(now() at time zone 'America/Lima', 'DD/MM/YYYY')), v_uid)
  returning id into v_id;
  return v_id;
end $$;

-- Registra (o corrige) la cantidad contada de un lote. p_sumar = true suma a lo ya contado (conteo por escaneo).
create or replace function public.contar_lote(p_conteo_id bigint, p_lote_id bigint, p_cantidad int, p_sumar boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._exigir_rol(array['admin','quimico','almacen']::rol_usuario[]);
  v_lote public.lotes; v_total int;
begin
  if not exists (select 1 from public.conteos where id = p_conteo_id and estado = 'abierto') then raise exception 'El conteo no está abierto'; end if;
  select * into v_lote from public.lotes where id = p_lote_id;
  if not found then raise exception 'Lote no existe'; end if;
  insert into public.conteo_items (conteo_id, producto_id, lote_id, stock_sistema, contado, usuario_id)
  values (p_conteo_id, v_lote.producto_id, p_lote_id, v_lote.stock, greatest(0, p_cantidad), v_uid)
  on conflict (conteo_id, lote_id) do update
    set contado = greatest(0, case when p_sumar then conteo_items.contado + p_cantidad else p_cantidad end),
        usuario_id = v_uid, updated_at = now()
  returning contado into v_total;
  return v_total;
end $$;

-- Cierra el conteo y ajusta el stock con la diferencia (contado - stock al momento de contar),
-- aplicada sobre el stock actual para no pisar las ventas hechas durante el conteo.
create or replace function public.cerrar_conteo(p_conteo_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._exigir_rol(array['admin','quimico']::rol_usuario[]);
  v_c public.conteos; it record; v_dif int; v_nuevo int; v_aj int := 0; v_val numeric := 0;
begin
  select * into v_c from public.conteos where id = p_conteo_id for update;
  if not found or v_c.estado <> 'abierto' then raise exception 'El conteo no está abierto'; end if;
  for it in select ci.*, l.stock as stock_actual, l.costo_unitario from public.conteo_items ci join public.lotes l on l.id = ci.lote_id
             where ci.conteo_id = p_conteo_id for update of l loop
    v_dif := it.contado - it.stock_sistema;
    continue when v_dif = 0;
    v_nuevo := greatest(0, it.stock_actual + v_dif);
    v_dif := v_nuevo - it.stock_actual;
    continue when v_dif = 0;
    update public.lotes set stock = v_nuevo where id = it.lote_id;
    insert into public.movimientos (producto_id, lote_id, tipo, cantidad, costo_unitario, saldo, referencia, nota, usuario_id)
    values (it.producto_id, it.lote_id, case when v_dif > 0 then 'ajuste_entrada' else 'ajuste_salida' end::tipo_movimiento, v_dif, it.costo_unitario,
            public._stock_producto(it.producto_id), 'Inventario N° ' || p_conteo_id, 'Ajuste por inventario físico', v_uid);
    v_aj := v_aj + 1; v_val := v_val + v_dif * it.costo_unitario;
  end loop;
  update public.conteos set estado = 'cerrado', cerrado_por = v_uid, cerrado_at = now() where id = p_conteo_id;
  return jsonb_build_object('ajustes', v_aj, 'valor', round(v_val, 2));
end $$;

create or replace function public.anular_conteo(p_conteo_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._exigir_rol(array['admin','quimico']::rol_usuario[]);
begin
  update public.conteos set estado = 'anulado', cerrado_por = v_uid, cerrado_at = now() where id = p_conteo_id and estado = 'abierto';
  if not found then raise exception 'El conteo no está abierto'; end if;
end $$;

revoke execute on function public.crear_conteo(text), public.contar_lote(bigint, bigint, int, boolean),
  public.cerrar_conteo(bigint), public.anular_conteo(bigint) from public, anon;


-- ---------------------------------------------------------------------
-- 20261113000007_blister_reclamaciones.sql
-- ---------------------------------------------------------------------
-- =====================================================================
-- Necesidades frecuentes de boticas en Perú:
--  1) Venta por blíster (tercer nivel entre unidad y caja).
--  2) Libro de Reclamaciones (Ley 29571, D.S. 011-2011-PCM).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Blíster
-- ---------------------------------------------------------------------
alter table public.productos
  add column if not exists unidades_por_blister int not null default 1 check (unidades_por_blister >= 1),
  add column if not exists precio_blister numeric(12,2) not null default 0 check (precio_blister >= 0);

-- v_productos expone p.*: se recrea para incluir las columnas nuevas.
drop view if exists public.v_productos;
create view public.v_productos with (security_invoker = true) as
select p.*, l.nombre as laboratorio, c.nombre as categoria,
       s.stock, s.stock_vendible, s.proximo_vencimiento
from public.productos p
left join public.laboratorios l on l.id = p.laboratorio_id
left join public.categorias c on c.id = p.categoria_id
left join public.v_stock s on s.producto_id = p.id;

-- registrar_venta acepta presentacion = 'blister'
do $$
declare v_def text; v_nuevo text;
begin
  select pg_get_functiondef('public.registrar_venta(jsonb)'::regprocedure) into v_def;
  v_nuevo := replace(v_def,
$a$    if v_item->>'presentacion' = 'empaque' then
      v_factor := v_prod.unidades_por_empaque;
      v_precio := v_prod.precio_empaque;
    else$a$,
$b$    if v_item->>'presentacion' = 'empaque' then
      v_factor := v_prod.unidades_por_empaque;
      v_precio := v_prod.precio_empaque;
    elsif v_item->>'presentacion' = 'blister' then
      if v_prod.unidades_por_blister <= 1 or v_prod.precio_blister <= 0 then
        raise exception '% no se vende por blíster', v_prod.nombre;
      end if;
      v_factor := v_prod.unidades_por_blister;
      v_precio := v_prod.precio_blister;
    else$b$);
  v_nuevo := replace(v_nuevo,
    $a$case when v_factor > 1 then ' (' || coalesce(v_prod.presentacion, 'x' || v_factor) || ')' else '' end$a$,
    $b$case when v_item->>'presentacion' = 'blister' then ' (Blíster x' || v_factor || ')'
                when v_factor > 1 then ' (' || coalesce(v_prod.presentacion, 'x' || v_factor) || ')' else '' end$b$);
  v_nuevo := replace(v_nuevo,
    $a$case when v_factor > 1 then 'BX' else 'NIU' end$a$,
    $b$case when v_item->>'presentacion' = 'empaque' and v_factor > 1 then 'BX' else 'NIU' end$b$);
  if v_nuevo = v_def or position('blister' in v_nuevo) = 0 then
    raise exception 'No se pudo actualizar registrar_venta para blíster (la función cambió)';
  end if;
  execute v_nuevo;
end $$;

-- ---------------------------------------------------------------------
-- 2) Libro de Reclamaciones
-- ---------------------------------------------------------------------
create table public.reclamaciones (
  id bigint generated always as identity primary key,
  numero text unique,                                  -- ej. 0001-2026
  fecha timestamptz not null default now(),
  consumidor_nombre text not null,
  consumidor_documento text not null,
  consumidor_domicilio text,
  consumidor_telefono text,
  consumidor_email text,
  apoderado text,                                      -- padre/madre si es menor de edad
  bien_tipo text not null default 'producto' check (bien_tipo in ('producto', 'servicio')),
  bien_descripcion text not null,
  monto numeric(12,2),
  tipo text not null check (tipo in ('reclamo', 'queja')),
  detalle text not null,
  pedido text not null,
  venta_id bigint references public.ventas(id),
  respuesta text,                                      -- acciones adoptadas por el proveedor
  respondido_at timestamptz,
  respondido_por uuid references public.perfiles(id),
  usuario_id uuid references public.perfiles(id) default auth.uid()
);
alter table public.reclamaciones enable row level security;
create policy lectura_reclamaciones on public.reclamaciones for select to authenticated using (public.es_usuario_activo());
create policy alta_reclamaciones on public.reclamaciones for insert to authenticated with check (public.es_usuario_activo());
create policy respuesta_reclamaciones on public.reclamaciones for update to authenticated using (public.tiene_rol(array['admin','quimico']::rol_usuario[]));

create or replace function public.numerar_reclamacion() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_anio text := to_char(now() at time zone 'America/Lima', 'YYYY'); v_n int;
begin
  perform pg_advisory_xact_lock(hashtext('reclamaciones' || v_anio));
  select count(*) + 1 into v_n from public.reclamaciones where numero like '%-' || v_anio;
  new.numero := lpad(v_n::text, 4, '0') || '-' || v_anio;
  return new;
end $$;
create trigger trg_reclamaciones_numero before insert on public.reclamaciones for each row execute function public.numerar_reclamacion();
create trigger aud_reclamaciones after insert or update or delete on public.reclamaciones for each row execute function fn_auditar();

-- Reclamos sin respuesta: el plazo legal es de 15 días hábiles
create or replace view public.v_reclamaciones_pendientes with (security_invoker = true) as
select id, numero, fecha, consumidor_nombre, tipo,
       (fecha at time zone 'America/Lima')::date + 21 as vence_aprox   -- ~15 días hábiles
  from public.reclamaciones where respuesta is null;

