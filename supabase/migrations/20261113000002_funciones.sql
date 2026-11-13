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
