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
