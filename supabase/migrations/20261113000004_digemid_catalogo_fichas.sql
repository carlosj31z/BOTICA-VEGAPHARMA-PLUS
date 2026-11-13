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
