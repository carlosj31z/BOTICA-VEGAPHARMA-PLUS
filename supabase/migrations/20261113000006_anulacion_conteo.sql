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
