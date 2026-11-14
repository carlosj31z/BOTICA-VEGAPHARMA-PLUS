-- =====================================================================
-- ERP Botica · Actualización del 14-nov-2026: precios de mercado (Observatorio DIGEMID)
-- Ejecutar UNA sola vez en el SQL Editor de Supabase, SOLO si ya ejecutó actualizar_etapa2.sql antes de esta fecha.
-- (Quien ejecute actualizar_etapa2.sql o instalar.sql desde hoy ya lo tiene incluido.)
-- =====================================================================

-- =====================================================================
-- Precios de mercado desde el Observatorio Peruano de Productos Farmacéuticos (DIGEMID).
-- Se consulta el buscador público del Observatorio para comparar los precios de la botica
-- con los que reportan las boticas y farmacias de su distrito (o provincia).
-- =====================================================================

-- Presentación del producto en el Observatorio (se resuelve una vez y se reutiliza)
alter table public.productos
  add column if not exists opm_grupo int,
  add column if not exists opm_grupo_ff text,
  add column if not exists opm_concent text;

-- v_productos expone p.*: se recrea para incluir las columnas nuevas.
drop view if exists public.v_productos;
create view public.v_productos with (security_invoker = true) as
select p.*, l.nombre as laboratorio, c.nombre as categoria,
       s.stock, s.stock_vendible, s.proximo_vencimiento
from public.productos p
left join public.laboratorios l on l.id = p.laboratorio_id
left join public.categorias c on c.id = p.categoria_id
left join public.v_stock s on s.producto_id = p.id;

create table if not exists public.precios_mercado (
  producto_id bigint primary key references public.productos(id) on delete cascade,
  consultado_at timestamptz not null default now(),
  ambito text,                         -- 'distrito' | 'provincia'
  ubigeo text,
  -- Mismo producto (mismo código DIGEMID) en otros establecimientos privados
  n_exacto int not null default 0,
  unidad_min numeric(12,2), unidad_mediana numeric(12,2), unidad_max numeric(12,2),
  empaque_min numeric(12,2), empaque_mediana numeric(12,2), empaque_max numeric(12,2),
  -- Equivalentes: mismo principio activo, concentración y forma (cualquier marca)
  n_equivalentes int not null default 0,
  equiv_unidad_min numeric(12,2), equiv_unidad_mediana numeric(12,2),
  equiv_mas_barato text,               -- "NOMBRE · LABORATORIO · S/ x.xx (BOTICA)"
  error text                           -- motivo si no se pudo consultar
);
alter table public.precios_mercado enable row level security;
create policy lectura_precios_mercado on public.precios_mercado for select to authenticated using (public.es_usuario_activo());
create policy alta_precios_mercado on public.precios_mercado for insert to authenticated with check (public.tiene_rol(array['admin','quimico']::rol_usuario[]));
create policy edicion_precios_mercado on public.precios_mercado for update to authenticated using (public.tiene_rol(array['admin','quimico']::rol_usuario[]));
create policy borrado_precios_mercado on public.precios_mercado for delete to authenticated using (public.tiene_rol(array['admin','quimico']::rol_usuario[]));

create or replace view public.v_precios_mercado with (security_invoker = true) as
select p.id as producto_id, p.codigo, p.nombre, p.principio_activo, p.concentracion, p.codigo_digemid,
       p.precio_unidad, p.precio_empaque, p.unidades_por_empaque, s.stock,
       m.consultado_at, m.ambito, m.n_exacto, m.unidad_min, m.unidad_mediana, m.unidad_max,
       m.empaque_min, m.empaque_mediana, m.empaque_max, m.n_equivalentes, m.equiv_unidad_min, m.equiv_unidad_mediana,
       m.equiv_mas_barato, m.error,
       case when m.unidad_mediana > 0 and p.precio_unidad > 0
            then round((p.precio_unidad / m.unidad_mediana - 1) * 100, 1) end as dif_mediana_pct
  from public.productos p
  left join public.precios_mercado m on m.producto_id = p.id
  left join public.v_stock s on s.producto_id = p.id
 where p.activo;
