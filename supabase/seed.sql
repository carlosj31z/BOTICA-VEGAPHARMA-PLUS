-- Datos de DEMOSTRACIÓN solo para desarrollo local (supabase db reset). No se cargan en producción.
update public.empresa set ruc = '20612345678', razon_social = 'BOTICA VEGA PHARMA PLUS S.A.C.', nombre_comercial = 'Vega Pharma Plus',
  direccion = 'Av. Ejemplo 123', distrito = 'Lima', provincia = 'Lima', departamento = 'Lima', telefono = '01 555 0000',
  cod_establecimiento = '0012345', director_tecnico = 'Q.F. Responsable Técnico', director_cqfp = '00000' where id = 1;

insert into public.laboratorios (nombre) values ('PORTUGAL'), ('MEDIFARMA'), ('FARMINDUSTRIA'), ('BAYER'), ('GENFAR'), ('ROEMMERS'), ('TEVA'), ('ABBOTT');
insert into public.categorias (nombre) values ('Analgésicos'), ('Antibióticos'), ('Antialérgicos'), ('Gastrointestinal'), ('Vitaminas'), ('Cuidado personal'), ('Controlados'), ('Respiratorio');

insert into public.productos (codigo, codigo_barras, nombre, principio_activo, concentracion, forma_farmaceutica, presentacion, laboratorio_id, categoria_id,
  registro_sanitario, codigo_digemid, condicion_venta, lista_control, unidades_por_empaque, precio_unidad, precio_empaque, costo_promedio, stock_minimo, refrigerado) values
 ('P0001','7750001000011','PARACETAMOL','Paracetamol','500 mg','Tableta','Caja x 100 tab.',1,1,'EN-00001','10001','libre',null,100,0.30,25.00,0.12,200,false),
 ('P0002','7750001000028','IBUPROFENO','Ibuprofeno','400 mg','Tableta','Caja x 100 tab.',2,1,'EN-00002','10002','libre',null,100,0.50,40.00,0.20,100,false),
 ('P0003','7750001000035','NAPROXENO SÓDICO','Naproxeno','550 mg','Tableta','Caja x 100 tab.',3,1,'EN-00003','10003','libre',null,100,0.80,65.00,0.35,100,false),
 ('P0004','7750001000042','AMOXICILINA','Amoxicilina','500 mg','Cápsula','Caja x 100 cáps.',5,2,'EN-00004','10004','receta',null,100,0.90,75.00,0.38,100,false),
 ('P0005','7750001000059','AZITROMICINA','Azitromicina','500 mg','Tableta','Caja x 3 tab.',6,2,'EN-00005','10005','receta',null,3,6.00,15.00,2.50,9,false),
 ('P0006','7750001000066','LORATADINA','Loratadina','10 mg','Tableta','Caja x 100 tab.',1,3,'EN-00006','10006','libre',null,100,0.40,30.00,0.15,100,false),
 ('P0007','7750001000073','CETIRIZINA','Cetirizina','10 mg','Tableta','Caja x 100 tab.',2,3,'EN-00007',null,'libre',null,100,0.50,35.00,0.18,50,false),
 ('P0008','7750001000080','OMEPRAZOL','Omeprazol','20 mg','Cápsula','Caja x 100 cáps.',3,4,'EN-00008','10008','libre',null,100,0.50,38.00,0.16,100,false),
 ('P0009','7750001000097','SAL DE ANDREWS','Bicarbonato de sodio','—','Sobre','Caja x 50 sobres',4,4,'EN-00009','10009','libre',null,50,1.20,50.00,0.70,50,false),
 ('P0010','7750001000103','VITAMINA C','Ácido ascórbico','1 g','Tableta efervescente','Tubo x 10',4,5,'EN-00010','10010','libre',null,10,1.50,12.00,0.80,20,false),
 ('P0011','7750001000110','CLONAZEPAM','Clonazepam','2 mg','Tableta','Caja x 30 tab.',8,7,'EN-00011','10011','controlado','IV',30,1.80,45.00,0.90,30,false),
 ('P0012','7750001000127','TRAMADOL','Tramadol','50 mg','Cápsula','Caja x 10 cáps.',7,7,'EN-00012','10012','receta_retenida',null,10,2.50,22.00,1.10,20,false),
 ('P0013','7750001000134','SALBUTAMOL INHALADOR','Salbutamol','100 mcg','Inhalador','Frasco x 200 dosis',5,8,'EN-00013','10013','receta',null,1,18.00,18.00,9.00,5,false),
 ('P0014','7750001000141','INSULINA NPH','Insulina humana','100 UI/mL','Inyectable','Frasco 10 mL',8,null,'BE-00014','10014','receta',null,1,45.00,45.00,30.00,3,true),
 ('P0015','7750001000158','ALCOHOL 70°','Alcohol etílico','70%','Solución','Frasco 250 mL',3,6,null,null,'libre',null,1,4.50,4.50,2.20,20,false),
 ('P0016','7750001000165','PANADOL ANTIGRIPAL','Paracetamol + fenilefrina','—','Tableta','Caja x 100 tab.',4,8,'EN-00016','10016','libre',null,100,1.00,85.00,0.55,50,false),
 ('P0017','7750001000172','DICLOFENACO','Diclofenaco','50 mg','Tableta','Caja x 100 tab.',1,1,'EN-00017','10017','libre',null,100,0.30,22.00,0.10,100,false),
 ('P0018','7750001000189','METFORMINA','Metformina','850 mg','Tableta','Caja x 100 tab.',7,null,'EN-00018','10018','receta',null,100,0.40,32.00,0.14,100,false);

insert into public.proveedores (ruc, razon_social, telefono, contacto) values
 ('20100000001','DROGUERÍA DEMO UNO S.A.C.','01 444 0001','Ventas'), ('20100000002','DISTRIBUIDORA FARMA DEMO S.A.','01 444 0002','Ventas');

-- Stock inicial por lote (incluye uno vencido y varios por vencer para ver las alertas)
insert into public.lotes (producto_id, numero_lote, fecha_vencimiento, stock, costo_unitario) values
 (1,'PA2401',current_date + 40, 300, 0.12), (1,'PA2502',current_date + 500, 1500, 0.12),
 (2,'IB2501',current_date + 400, 800, 0.20), (3,'NA2501',current_date + 300, 600, 0.35),
 (4,'AM2501',current_date + 200, 500, 0.38), (5,'AZ2501',current_date + 365, 60, 2.50),
 (6,'LO2401',current_date - 10, 40, 0.15), (6,'LO2502',current_date + 420, 700, 0.15),
 (7,'CE2501',current_date + 380, 30, 0.18), (8,'OM2501',current_date + 75, 900, 0.16),
 (9,'SA2501',current_date + 600, 200, 0.70), (10,'VC2501',current_date + 250, 80, 0.80),
 (11,'CL2501',current_date + 500, 90, 0.90), (12,'TR2501',current_date + 450, 50, 1.10),
 (13,'SB2501',current_date + 330, 12, 9.00), (14,'IN2501',current_date + 120, 6, 30.00),
 (15,'AL2501',current_date + 900, 48, 2.20), (16,'PG2501',current_date + 280, 400, 0.55),
 (17,'DI2501',current_date + 25, 500, 0.10), (18,'MF2501',current_date + 700, 600, 0.14);

insert into public.movimientos (producto_id, lote_id, tipo, cantidad, costo_unitario, saldo, nota, usuario_id)
select l.producto_id, l.id, 'inventario_inicial', l.stock, l.costo_unitario,
       sum(l.stock) over (partition by l.producto_id order by l.id), 'Carga inicial (demo)', null
  from public.lotes l;
