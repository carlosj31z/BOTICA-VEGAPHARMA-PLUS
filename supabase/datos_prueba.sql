-- =====================================================================
-- PRODUCTOS DE PRUEBA para conocer el sistema (pegar en Supabase → SQL Editor → Run).
-- Crea laboratorios, categorías, 2 proveedores y ~46 productos frecuentes con stock por lote
-- (algunos lotes por vencer a propósito, para ver las alertas).
-- Los lotes de prueba empiezan con «PRUEBA-». El código DIGEMID queda vacío: después de importar el
-- catálogo DIGEMID use Productos → «Vincular códigos DIGEMID» para asignarlos.
-- Para BORRAR estos datos de prueba ejecute el bloque comentado al final.
-- =====================================================================
begin;
insert into public.laboratorios (nombre) values ('ALKOFARMA'), ('BAYER'), ('BOEHRINGER'), ('FARMINDUSTRIA'), ('GENFAR'), ('GSK'), ('IQ FARMA'), ('MEDIFARMA'), ('NOVO NORDISK'), ('PORTUGAL'), ('ROCHE'), ('SANOFI') on conflict (nombre) do nothing;
insert into public.categorias (nombre) values ('Analgésicos'), ('Antialérgicos'), ('Antibióticos'), ('Antimicóticos'), ('Antiparasitarios'), ('Cardiovascular'), ('Controlados'), ('Cuidado personal'), ('Diabetes'), ('Gastrointestinal'), ('Respiratorio'), ('Salud sexual'), ('Vitaminas') on conflict (nombre) do nothing;
insert into public.proveedores (ruc, razon_social, contacto) values ('20000000001','DROGUERÍA DE PRUEBA 1 S.A.C.','Ventas'), ('20000000002','DROGUERÍA DE PRUEBA 2 S.A.C.','Ventas') on conflict (ruc) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0001', 'PARACETAMOL', 'Paracetamol', '500 mg', 'Tableta', 'Caja x 100 tab.', (select id from public.laboratorios where nombre = 'PORTUGAL'), (select id from public.categorias where nombre = 'Analgésicos'),
  'libre', null, 100, 0.2, 15.0, 0.08, 200, false
where not exists (select 1 from public.productos where codigo = 'PR0001');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-01', current_date + 600, 1000, 0.08 from public.productos where codigo = 'PR0001' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0002', 'PARACETAMOL JARABE', 'Paracetamol', '120 mg/5 mL', 'Jarabe', 'Frasco 60 mL', (select id from public.laboratorios where nombre = 'MEDIFARMA'), (select id from public.categorias where nombre = 'Analgésicos'),
  'libre', null, 1, 4.5, 4.5, 1.9, 10, false
where not exists (select 1 from public.productos where codigo = 'PR0002');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-02', current_date + 500, 30, 1.9 from public.productos where codigo = 'PR0002' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0003', 'PANADOL', 'Paracetamol', '500 mg', 'Tableta', 'Caja x 100 tab.', (select id from public.laboratorios where nombre = 'GSK'), (select id from public.categorias where nombre = 'Analgésicos'),
  'libre', null, 100, 0.8, 70.0, 0.45, 100, false
where not exists (select 1 from public.productos where codigo = 'PR0003');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-03', current_date + 450, 400, 0.45 from public.productos where codigo = 'PR0003' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0004', 'IBUPROFENO', 'Ibuprofeno', '400 mg', 'Tableta', 'Caja x 100 tab.', (select id from public.laboratorios where nombre = 'PORTUGAL'), (select id from public.categorias where nombre = 'Analgésicos'),
  'libre', null, 100, 0.3, 25.0, 0.11, 200, false
where not exists (select 1 from public.productos where codigo = 'PR0004');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-04', current_date + 520, 800, 0.11 from public.productos where codigo = 'PR0004' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0005', 'IBUPROFENO SUSPENSIÓN', 'Ibuprofeno', '100 mg/5 mL', 'Suspensión', 'Frasco 60 mL', (select id from public.laboratorios where nombre = 'FARMINDUSTRIA'), (select id from public.categorias where nombre = 'Analgésicos'),
  'libre', null, 1, 6.0, 6.0, 2.5, 10, false
where not exists (select 1 from public.productos where codigo = 'PR0005');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-05', current_date + 400, 25, 2.5 from public.productos where codigo = 'PR0005' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0006', 'NAPROXENO SÓDICO', 'Naproxeno', '550 mg', 'Tableta', 'Caja x 100 tab.', (select id from public.laboratorios where nombre = 'MEDIFARMA'), (select id from public.categorias where nombre = 'Analgésicos'),
  'libre', null, 100, 0.6, 50.0, 0.25, 100, false
where not exists (select 1 from public.productos where codigo = 'PR0006');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-06', current_date + 480, 500, 0.25 from public.productos where codigo = 'PR0006' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0007', 'DICLOFENACO', 'Diclofenaco', '50 mg', 'Tableta', 'Caja x 100 tab.', (select id from public.laboratorios where nombre = 'PORTUGAL'), (select id from public.categorias where nombre = 'Analgésicos'),
  'libre', null, 100, 0.2, 15.0, 0.07, 100, false
where not exists (select 1 from public.productos where codigo = 'PR0007');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-07', current_date + 40, 600, 0.07 from public.productos where codigo = 'PR0007' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0008', 'DICLOFENACO GEL', 'Diclofenaco', '1%', 'Gel', 'Tubo 50 g', (select id from public.laboratorios where nombre = 'GENFAR'), (select id from public.categorias where nombre = 'Analgésicos'),
  'libre', null, 1, 9.0, 9.0, 4.2, 5, false
where not exists (select 1 from public.productos where codigo = 'PR0008');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-08', current_date + 700, 15, 4.2 from public.productos where codigo = 'PR0008' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0009', 'METAMIZOL', 'Metamizol', '500 mg', 'Tableta', 'Caja x 100 tab.', (select id from public.laboratorios where nombre = 'FARMINDUSTRIA'), (select id from public.categorias where nombre = 'Analgésicos'),
  'receta', null, 100, 0.4, 30.0, 0.15, 100, false
where not exists (select 1 from public.productos where codigo = 'PR0009');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-09', current_date + 380, 400, 0.15 from public.productos where codigo = 'PR0009' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0010', 'AMOXICILINA', 'Amoxicilina', '500 mg', 'Cápsula', 'Caja x 100 cáps.', (select id from public.laboratorios where nombre = 'PORTUGAL'), (select id from public.categorias where nombre = 'Antibióticos'),
  'receta', null, 100, 0.6, 50.0, 0.24, 100, false
where not exists (select 1 from public.productos where codigo = 'PR0010');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-10', current_date + 300, 600, 0.24 from public.productos where codigo = 'PR0010' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0011', 'AMOXICILINA SUSPENSIÓN', 'Amoxicilina', '250 mg/5 mL', 'Polvo para suspensión', 'Frasco 60 mL', (select id from public.laboratorios where nombre = 'MEDIFARMA'), (select id from public.categorias where nombre = 'Antibióticos'),
  'receta', null, 1, 7.5, 7.5, 3.1, 10, false
where not exists (select 1 from public.productos where codigo = 'PR0011');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-11', current_date + 280, 20, 3.1 from public.productos where codigo = 'PR0011' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0012', 'AMOXICILINA + ÁCIDO CLAVULÁNICO', 'Amoxicilina + ácido clavulánico', '875/125 mg', 'Tableta', 'Caja x 14 tab.', (select id from public.laboratorios where nombre = 'IQ FARMA'), (select id from public.categorias where nombre = 'Antibióticos'),
  'receta', null, 14, 3.5, 45.0, 1.7, 14, false
where not exists (select 1 from public.productos where codigo = 'PR0012');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-12', current_date + 420, 84, 1.7 from public.productos where codigo = 'PR0012' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0013', 'AZITROMICINA', 'Azitromicina', '500 mg', 'Tableta', 'Caja x 3 tab.', (select id from public.laboratorios where nombre = 'GENFAR'), (select id from public.categorias where nombre = 'Antibióticos'),
  'receta', null, 3, 3.0, 8.0, 1.2, 9, false
where not exists (select 1 from public.productos where codigo = 'PR0013');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-13', current_date + 365, 60, 1.2 from public.productos where codigo = 'PR0013' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0014', 'CIPROFLOXACINO', 'Ciprofloxacino', '500 mg', 'Tableta', 'Caja x 100 tab.', (select id from public.laboratorios where nombre = 'PORTUGAL'), (select id from public.categorias where nombre = 'Antibióticos'),
  'receta', null, 100, 0.5, 40.0, 0.18, 50, false
where not exists (select 1 from public.productos where codigo = 'PR0014');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-14', current_date + 420, 300, 0.18 from public.productos where codigo = 'PR0014' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0015', 'CEFALEXINA', 'Cefalexina', '500 mg', 'Cápsula', 'Caja x 100 cáps.', (select id from public.laboratorios where nombre = 'MEDIFARMA'), (select id from public.categorias where nombre = 'Antibióticos'),
  'receta', null, 100, 0.8, 65.0, 0.32, 50, false
where not exists (select 1 from public.productos where codigo = 'PR0015');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-15', current_date + 330, 300, 0.32 from public.productos where codigo = 'PR0015' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0016', 'METRONIDAZOL', 'Metronidazol', '500 mg', 'Tableta', 'Caja x 100 tab.', (select id from public.laboratorios where nombre = 'FARMINDUSTRIA'), (select id from public.categorias where nombre = 'Antiparasitarios'),
  'receta', null, 100, 0.3, 25.0, 0.1, 50, false
where not exists (select 1 from public.productos where codigo = 'PR0016');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-16', current_date + 500, 300, 0.1 from public.productos where codigo = 'PR0016' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0017', 'FLUCONAZOL', 'Fluconazol', '150 mg', 'Cápsula', 'Caja x 1 cáps.', (select id from public.laboratorios where nombre = 'GENFAR'), (select id from public.categorias where nombre = 'Antimicóticos'),
  'libre', null, 1, 4.0, 4.0, 1.2, 10, false
where not exists (select 1 from public.productos where codigo = 'PR0017');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-17', current_date + 600, 40, 1.2 from public.productos where codigo = 'PR0017' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0018', 'CLOTRIMAZOL CREMA', 'Clotrimazol', '1%', 'Crema', 'Tubo 20 g', (select id from public.laboratorios where nombre = 'PORTUGAL'), (select id from public.categorias where nombre = 'Antimicóticos'),
  'libre', null, 1, 5.0, 5.0, 1.8, 5, false
where not exists (select 1 from public.productos where codigo = 'PR0018');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-18', current_date + 650, 20, 1.8 from public.productos where codigo = 'PR0018' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0019', 'ALBENDAZOL', 'Albendazol', '400 mg', 'Tableta', 'Caja x 1 tab.', (select id from public.laboratorios where nombre = 'MEDIFARMA'), (select id from public.categorias where nombre = 'Antiparasitarios'),
  'libre', null, 1, 3.0, 3.0, 0.9, 20, false
where not exists (select 1 from public.productos where codigo = 'PR0019');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-19', current_date + 700, 80, 0.9 from public.productos where codigo = 'PR0019' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0020', 'LORATADINA', 'Loratadina', '10 mg', 'Tableta', 'Caja x 100 tab.', (select id from public.laboratorios where nombre = 'PORTUGAL'), (select id from public.categorias where nombre = 'Antialérgicos'),
  'libre', null, 100, 0.3, 25.0, 0.09, 100, false
where not exists (select 1 from public.productos where codigo = 'PR0020');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-20', current_date + 15, 700, 0.09 from public.productos where codigo = 'PR0020' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0021', 'CETIRIZINA', 'Cetirizina', '10 mg', 'Tableta', 'Caja x 100 tab.', (select id from public.laboratorios where nombre = 'GENFAR'), (select id from public.categorias where nombre = 'Antialérgicos'),
  'libre', null, 100, 0.4, 30.0, 0.13, 100, false
where not exists (select 1 from public.productos where codigo = 'PR0021');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-21', current_date + 540, 40, 0.13 from public.productos where codigo = 'PR0021' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0022', 'CLORFENAMINA', 'Clorfenamina', '4 mg', 'Tableta', 'Caja x 100 tab.', (select id from public.laboratorios where nombre = 'FARMINDUSTRIA'), (select id from public.categorias where nombre = 'Antialérgicos'),
  'libre', null, 100, 0.15, 10.0, 0.05, 100, false
where not exists (select 1 from public.productos where codigo = 'PR0022');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-22', current_date + 600, 500, 0.05 from public.productos where codigo = 'PR0022' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0023', 'OMEPRAZOL', 'Omeprazol', '20 mg', 'Cápsula', 'Caja x 100 cáps.', (select id from public.laboratorios where nombre = 'PORTUGAL'), (select id from public.categorias where nombre = 'Gastrointestinal'),
  'libre', null, 100, 0.3, 25.0, 0.1, 100, false
where not exists (select 1 from public.productos where codigo = 'PR0023');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-23', current_date + 75, 800, 0.1 from public.productos where codigo = 'PR0023' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0024', 'ESOMEPRAZOL', 'Esomeprazol', '40 mg', 'Tableta', 'Caja x 14 tab.', (select id from public.laboratorios where nombre = 'IQ FARMA'), (select id from public.categorias where nombre = 'Gastrointestinal'),
  'receta', null, 14, 2.5, 30.0, 1.1, 14, false
where not exists (select 1 from public.productos where codigo = 'PR0024');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-24', current_date + 500, 70, 1.1 from public.productos where codigo = 'PR0024' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0025', 'SAL DE ANDREWS', 'Bicarbonato de sodio', '—', 'Sobre', 'Caja x 50 sobres', (select id from public.laboratorios where nombre = 'GSK'), (select id from public.categorias where nombre = 'Gastrointestinal'),
  'libre', null, 50, 1.2, 50.0, 0.7, 50, false
where not exists (select 1 from public.productos where codigo = 'PR0025');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-25', current_date + 600, 200, 0.7 from public.productos where codigo = 'PR0025' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0026', 'MILANTA', 'Hidróxido de aluminio + hidróxido de magnesio', '—', 'Suspensión', 'Frasco 360 mL', (select id from public.laboratorios where nombre = 'SANOFI'), (select id from public.categorias where nombre = 'Gastrointestinal'),
  'libre', null, 1, 22.0, 22.0, 13.0, 3, false
where not exists (select 1 from public.productos where codigo = 'PR0026');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-26', current_date + 400, 10, 13.0 from public.productos where codigo = 'PR0026' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0027', 'LOPERAMIDA', 'Loperamida', '2 mg', 'Tableta', 'Caja x 100 tab.', (select id from public.laboratorios where nombre = 'MEDIFARMA'), (select id from public.categorias where nombre = 'Gastrointestinal'),
  'libre', null, 100, 0.4, 30.0, 0.12, 50, false
where not exists (select 1 from public.productos where codigo = 'PR0027');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-27', current_date + 500, 300, 0.12 from public.productos where codigo = 'PR0027' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0028', 'SUERO ORAL', 'Sales de rehidratación oral', '—', 'Polvo', 'Sobre 27.9 g', (select id from public.laboratorios where nombre = 'MEDIFARMA'), (select id from public.categorias where nombre = 'Gastrointestinal'),
  'libre', null, 1, 1.5, 1.5, 0.6, 30, false
where not exists (select 1 from public.productos where codigo = 'PR0028');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-28', current_date + 700, 120, 0.6 from public.productos where codigo = 'PR0028' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0029', 'BUSCAPINA', 'Butilescopolamina', '10 mg', 'Tableta', 'Caja x 100 tab.', (select id from public.laboratorios where nombre = 'BOEHRINGER'), (select id from public.categorias where nombre = 'Gastrointestinal'),
  'libre', null, 100, 1.0, 85.0, 0.55, 50, false
where not exists (select 1 from public.productos where codigo = 'PR0029');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-29', current_date + 450, 300, 0.55 from public.productos where codigo = 'PR0029' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0030', 'SALBUTAMOL INHALADOR', 'Salbutamol', '100 mcg/dosis', 'Aerosol para inhalación', 'Frasco x 200 dosis', (select id from public.laboratorios where nombre = 'GENFAR'), (select id from public.categorias where nombre = 'Respiratorio'),
  'receta', null, 1, 15.0, 15.0, 7.5, 5, false
where not exists (select 1 from public.productos where codigo = 'PR0030');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-30', current_date + 500, 12, 7.5 from public.productos where codigo = 'PR0030' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0031', 'AMBROXOL JARABE', 'Ambroxol', '30 mg/5 mL', 'Jarabe', 'Frasco 120 mL', (select id from public.laboratorios where nombre = 'PORTUGAL'), (select id from public.categorias where nombre = 'Respiratorio'),
  'libre', null, 1, 6.5, 6.5, 2.6, 10, false
where not exists (select 1 from public.productos where codigo = 'PR0031');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-31', current_date + 450, 25, 2.6 from public.productos where codigo = 'PR0031' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0032', 'PANADOL ANTIGRIPAL', 'Paracetamol + fenilefrina + clorfenamina', '—', 'Tableta', 'Caja x 100 tab.', (select id from public.laboratorios where nombre = 'GSK'), (select id from public.categorias where nombre = 'Respiratorio'),
  'libre', null, 100, 1.0, 85.0, 0.55, 100, false
where not exists (select 1 from public.productos where codigo = 'PR0032');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-32', current_date + 420, 500, 0.55 from public.productos where codigo = 'PR0032' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0033', 'LOSARTÁN', 'Losartán', '50 mg', 'Tableta', 'Caja x 100 tab.', (select id from public.laboratorios where nombre = 'PORTUGAL'), (select id from public.categorias where nombre = 'Cardiovascular'),
  'receta', null, 100, 0.3, 25.0, 0.09, 100, false
where not exists (select 1 from public.productos where codigo = 'PR0033');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-33', current_date + 550, 800, 0.09 from public.productos where codigo = 'PR0033' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0034', 'ENALAPRIL', 'Enalapril', '10 mg', 'Tableta', 'Caja x 100 tab.', (select id from public.laboratorios where nombre = 'FARMINDUSTRIA'), (select id from public.categorias where nombre = 'Cardiovascular'),
  'receta', null, 100, 0.2, 15.0, 0.06, 100, false
where not exists (select 1 from public.productos where codigo = 'PR0034');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-34', current_date + 520, 600, 0.06 from public.productos where codigo = 'PR0034' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0035', 'AMLODIPINO', 'Amlodipino', '5 mg', 'Tableta', 'Caja x 100 tab.', (select id from public.laboratorios where nombre = 'GENFAR'), (select id from public.categorias where nombre = 'Cardiovascular'),
  'receta', null, 100, 0.3, 25.0, 0.08, 100, false
where not exists (select 1 from public.productos where codigo = 'PR0035');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-35', current_date + 500, 600, 0.08 from public.productos where codigo = 'PR0035' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0036', 'ATORVASTATINA', 'Atorvastatina', '20 mg', 'Tableta', 'Caja x 30 tab.', (select id from public.laboratorios where nombre = 'IQ FARMA'), (select id from public.categorias where nombre = 'Cardiovascular'),
  'receta', null, 30, 1.0, 25.0, 0.4, 30, false
where not exists (select 1 from public.productos where codigo = 'PR0036');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-36', current_date + 480, 180, 0.4 from public.productos where codigo = 'PR0036' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0037', 'METFORMINA', 'Metformina', '850 mg', 'Tableta', 'Caja x 100 tab.', (select id from public.laboratorios where nombre = 'PORTUGAL'), (select id from public.categorias where nombre = 'Diabetes'),
  'receta', null, 100, 0.25, 20.0, 0.08, 100, false
where not exists (select 1 from public.productos where codigo = 'PR0037');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-37', current_date + 700, 900, 0.08 from public.productos where codigo = 'PR0037' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0038', 'INSULINA HUMANA NPH', 'Insulina humana NPH', '100 UI/mL', 'Inyectable', 'Frasco 10 mL', (select id from public.laboratorios where nombre = 'NOVO NORDISK'), (select id from public.categorias where nombre = 'Diabetes'),
  'receta', null, 1, 48.0, 48.0, 32.0, 3, true
where not exists (select 1 from public.productos where codigo = 'PR0038');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-38', current_date + 150, 8, 32.0 from public.productos where codigo = 'PR0038' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0039', 'SULFATO FERROSO', 'Sulfato ferroso', '300 mg', 'Tableta', 'Caja x 100 tab.', (select id from public.laboratorios where nombre = 'MEDIFARMA'), (select id from public.categorias where nombre = 'Vitaminas'),
  'libre', null, 100, 0.2, 15.0, 0.06, 100, false
where not exists (select 1 from public.productos where codigo = 'PR0039');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-39', current_date + 600, 500, 0.06 from public.productos where codigo = 'PR0039' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0040', 'ÁCIDO FÓLICO', 'Ácido fólico', '0.5 mg', 'Tableta', 'Caja x 100 tab.', (select id from public.laboratorios where nombre = 'PORTUGAL'), (select id from public.categorias where nombre = 'Vitaminas'),
  'libre', null, 100, 0.1, 8.0, 0.03, 100, false
where not exists (select 1 from public.productos where codigo = 'PR0040');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-40', current_date + 600, 500, 0.03 from public.productos where codigo = 'PR0040' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0041', 'VITAMINA C EFERVESCENTE', 'Vitamina C', '1 g', 'Tableta efervescente', 'Tubo x 10', (select id from public.laboratorios where nombre = 'BAYER'), (select id from public.categorias where nombre = 'Vitaminas'),
  'libre', null, 10, 1.5, 13.0, 0.8, 20, false
where not exists (select 1 from public.productos where codigo = 'PR0041');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-41', current_date + 400, 100, 0.8 from public.productos where codigo = 'PR0041' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0042', 'CLONAZEPAM', 'Clonazepam', '2 mg', 'Tableta', 'Caja x 30 tab.', (select id from public.laboratorios where nombre = 'ROCHE'), (select id from public.categorias where nombre = 'Controlados'),
  'controlado', 'IV', 30, 1.8, 45.0, 0.9, 30, false
where not exists (select 1 from public.productos where codigo = 'PR0042');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-42', current_date + 500, 90, 0.9 from public.productos where codigo = 'PR0042' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0043', 'TRAMADOL', 'Tramadol', '50 mg', 'Cápsula', 'Caja x 10 cáps.', (select id from public.laboratorios where nombre = 'GENFAR'), (select id from public.categorias where nombre = 'Controlados'),
  'receta_retenida', null, 10, 2.0, 18.0, 0.9, 20, false
where not exists (select 1 from public.productos where codigo = 'PR0043');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-43', current_date + 450, 60, 0.9 from public.productos where codigo = 'PR0043' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0044', 'LEVONORGESTREL', 'Levonorgestrel', '1.5 mg', 'Tableta', 'Caja x 1 tab.', (select id from public.laboratorios where nombre = 'IQ FARMA'), (select id from public.categorias where nombre = 'Salud sexual'),
  'libre', null, 1, 12.0, 12.0, 5.0, 5, false
where not exists (select 1 from public.productos where codigo = 'PR0044');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-44', current_date + 600, 20, 5.0 from public.productos where codigo = 'PR0044' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0045', 'SILDENAFILO', 'Sildenafilo', '50 mg', 'Tableta', 'Caja x 2 tab.', (select id from public.laboratorios where nombre = 'GENFAR'), (select id from public.categorias where nombre = 'Salud sexual'),
  'receta', null, 2, 5.0, 9.0, 2.0, 6, false
where not exists (select 1 from public.productos where codigo = 'PR0045');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-45', current_date + 600, 30, 2.0 from public.productos where codigo = 'PR0045' on conflict (producto_id, numero_lote) do nothing;
insert into public.productos (codigo, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado)
select 'PR0046', 'ALCOHOL 70°', 'Alcohol etílico', '70%', 'Solución', 'Frasco 250 mL', (select id from public.laboratorios where nombre = 'ALKOFARMA'), (select id from public.categorias where nombre = 'Cuidado personal'),
  'libre', null, 1, 4.5, 4.5, 2.2, 20, false
where not exists (select 1 from public.productos where codigo = 'PR0046');
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario)
select id, 'PRUEBA-46', current_date + 900, 48, 2.2 from public.productos where codigo = 'PR0046' on conflict (producto_id, numero_lote) do nothing;
insert into public.movimientos (producto_id, lote_id, tipo, cantidad, costo_unitario, saldo, nota, usuario_id)
select l.producto_id, l.id, 'inventario_inicial', l.stock, l.costo_unitario, l.stock, 'Datos de prueba', null
  from public.lotes l where l.numero_lote like 'PRUEBA-%'
   and not exists (select 1 from public.movimientos m where m.lote_id = l.id);

-- Venta por blíster (requiere actualizar_etapa2.sql): tabletas y cápsulas en caja de 100 se venden también por blíster de 10.
update public.productos set unidades_por_blister = 10, precio_blister = round(precio_unidad * 10 * 0.95, 1)
 where codigo like 'PR____' and unidades_por_empaque >= 50 and forma_farmaceutica in ('Tableta', 'Cápsula', 'Tableta recubierta');
commit;

-- ---------------------------------------------------------------------
-- BORRAR DATOS DE PRUEBA (solo si aún no hay ventas con ellos). Quite los dos guiones de cada línea y ejecute:
-- delete from public.movimientos where lote_id in (select id from public.lotes where numero_lote like 'PRUEBA-%');
-- delete from public.lotes where numero_lote like 'PRUEBA-%';
-- delete from public.productos where codigo like 'PR____' and not exists (select 1 from public.venta_items vi where vi.producto_id = productos.id);
-- delete from public.proveedores where ruc in ('20000000001','20000000002');
