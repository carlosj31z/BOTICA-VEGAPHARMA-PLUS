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
