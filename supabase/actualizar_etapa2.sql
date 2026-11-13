-- =====================================================================
-- ERP Botica · Actualización a la etapa 2 (para quien ya ejecutó instalar.sql de la etapa 1)
-- Ejecutar UNA sola vez en el SQL Editor de Supabase. Agrega: alertas sanitarias DIGEMID, bloqueo de lotes, catálogo DIGEMID,
-- fichas de medicamentos (vademécum), anulación ante SUNAT, inventario físico, venta por blíster y Libro de Reclamaciones.
-- =====================================================================

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

