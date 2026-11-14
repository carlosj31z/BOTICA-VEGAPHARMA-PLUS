# Vega Pharma Plus · ERP para botica

Sistema web para la operación diaria de una botica en Perú, alineado con **SUNAT** (comprobantes electrónicos) y **DIGEMID** (recetas, controlados, vencimientos y Observatorio de Precios). Pensado para computadora de escritorio, con atajos de teclado y lector de código de barras.

**Stack:** Next.js 15 (App Router) · Supabase (Postgres + Auth + RLS) · Vercel · Tailwind CSS.

![Punto de venta](docs/capturas/04-pos-carrito.png)

## Módulos

| Módulo | Qué hace |
|---|---|
| **Punto de venta** (`F1`) | Pensado para trabajar solo con teclado y lector. Búsqueda por nombre, principio activo o código de barras con **orientación del medicamento** al lado; venta por **unidad, blíster o caja**; **genéricos y alternativas** más baratas (`F7`); descuentos; boleta, factura o nota de venta; consulta de **DNI/RUC** (RENIEC/SUNAT); pagos en efectivo con vuelto, **tarjeta por POS** (Izipay, Niubiz, OpenPay, Culqi, Mercado Pago u otro, con N° de operación), Yape, Plin, transferencia y **pagos mixtos**; comprobante por **WhatsApp**. El carrito sobrevive a una recarga. |
| **Lector de códigos** | Lector USB tradicional (funciona aunque el cursor no esté en el buscador), **cámara** de la PC o tablet, y **celular como lector**: abra `/escaner` en el teléfono con el mismo usuario y cada lectura cae en el carrito de la caja; también sirve para consultar precio y stock en el anaquel. |
| **Vademécum** | 68 fichas: para qué sirve, cómo actúa, dosis, contraindicaciones, interacciones y qué recomendar. Editable por el químico farmacéutico. |
| **Inventario físico** | Toma de inventario por lote escaneando; al cerrar ajusta el stock con la diferencia y lo deja en el kardex. |
| **Libro de Reclamaciones** | Hojas numeradas con el formato oficial, impresión para el consumidor y control del plazo de 15 días hábiles. |
| **Ventas con receta** | Productos marcados como *con receta*, *receta retenida* o *controlado* exigen paciente, médico y CMP; los controlados solo los dispensa el químico farmacéutico. |
| **Caja y turnos** | Apertura con fondo, ingresos/egresos, arqueo por denominaciones, diferencia y reporte de cierre imprimible (80 mm). Un turno por caja y por usuario. |
| **Historial de ventas** | Filtros, exportación CSV, reimpresión de ticket, **notas de crédito** (devuelven stock a los mismos lotes), **anulación ante SUNAT** (comunicación de baja, dentro de 7 días) y anulación de notas de venta. |
| **Facturación SUNAT** | Envío a través de un PSE (Nubefact incluido; la interfaz permite agregar otros sin tocar el resto del sistema). Ticket con QR SUNAT e importe en letras. Panel de pendientes, rechazados y reenvío. Si el proveedor no responde, la venta no se bloquea: queda *pendiente* y se reenvía (botón o cron diario). |
| **Productos** | Nombre, DCI, concentración, forma, presentación, laboratorio, **registro sanitario**, **código DIGEMID**, condición de venta, lista de control, unidades por caja, precios por unidad y caja, afectación IGV, stock mínimo, ubicación, cadena de frío. |
| **Lotes y vencimientos** | Stock por lote con salida **FEFO** automática (nunca vende lotes vencidos), alertas por vencer/vencidos, bajas por vencimiento, merma o devolución. |
| **Kardex** | Movimientos valorizados por producto y lote con saldo, usuario y referencia. Exportable. |
| **Compras y proveedores** | Registro por factura con lote y vencimiento por ítem, costo promedio ponderado y actualización opcional del precio de venta. |
| **DIGEMID** | **Alertas sanitarias** leídas a diario de la web de DIGEMID y cruzadas con sus lotes y registros sanitarios (bloqueo de lote con un clic), vencimientos y stock, **catálogo DIGEMID** importable con asistente para asignar el CodProd, **libro de recetas y controlados** y **archivo para el Observatorio de Precios**. |
| **Reportes** | Venta neta, utilidad y margen, ticket promedio, venta por día y hora, por medio de pago, por usuario, productos más vendidos, valorización del inventario. |
| **Usuarios** | Roles: administrador, químico farmacéutico, cajero y almacén. Todo queda registrado con el usuario; auditoría de cambios en productos, usuarios y configuración. |

### Observatorio de Precios (DIGEMID)

**Comparar con el mercado.** `DIGEMID → Observatorio de precios → Comparar con el mercado → Sincronizar con el Observatorio` consulta el buscador público del Observatorio y muestra, por producto, el precio mínimo, la mediana y el máximo que reportan las boticas privadas de su distrito (o de su provincia si hay pocas), si usted está por encima o por debajo, y el genérico equivalente más barato. Requiere el **ubigeo** del establecimiento en Configuración. Cada día el cron actualiza un lote de 20 productos.

**Reportar mis precios.**

`DIGEMID → Observatorio de precios` genera el archivo que se sube en el portal del Observatorio:

- CSV UTF-8, separado por comas, fin de línea CRLF, cabecera exacta `CodEstab,CodProd,Precio 1,Precio 2`.
- `CodEstab`: código del establecimiento (7 dígitos, con ceros a la izquierda), se configura en *Configuración*.
- `CodProd`: código del producto en el catálogo DIGEMID (campo *Código DIGEMID* del producto).
- `Precio 1` = precio por empaque, `Precio 2` = precio por unidad, con 2 decimales.
- También se descarga en ZIP. Muestra qué productos quedan fuera y por qué, y permite validar los códigos contra el catálogo de DIGEMID en CSV.

> El formato se tomó del manual de carga de marzo de 2026 a través de una implementación pública. Haga una carga de prueba para confirmarlo; si DIGEMID cambia el formato, solo hay que ajustar `src/lib/observatorio.ts`.

## Puesta en marcha

### 1. Base de datos (Supabase)

1. En su proyecto de Supabase abra **SQL Editor → New query**, pegue el contenido de [`supabase/instalar.sql`](supabase/instalar.sql) y pulse **Run**. Crea tablas, funciones, vistas y seguridad (RLS). No carga datos de demostración.
   - **Si ya instaló la etapa 1**, ejecute solo [`supabase/actualizar_etapa2.sql`](supabase/actualizar_etapa2.sql).
   - Opcional: [`supabase/datos_prueba.sql`](supabase/datos_prueba.sql) carga 46 productos de prueba con lotes `PRUEBA-NN` (al final del archivo está cómo borrarlos).
2. En **Authentication → Sign In / Providers**, desactive **Allow new users to sign up**. Los usuarios se crean desde el propio ERP.
3. En **Authentication → Users → Add user → Create new user**, cree su usuario con correo y contraseña (marque *Auto confirm*). **El primer usuario creado es el administrador.**

Alternativa con CLI: `npx supabase link --project-ref <ref>` y `npx supabase db push`.

### 2. Despliegue (Vercel)

1. En Vercel: **Add New → Project → Import** este repositorio. El framework se detecta solo.
2. En **Environment Variables** cargue las de [`.env.example`](.env.example):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API).
   - `NUBEFACT_RUTA` y `NUBEFACT_TOKEN` cuando tenga la cuenta de facturación (mientras tanto las ventas quedan *pendientes*).
   - `CRON_SECRET`: un texto largo aleatorio.
   - Opcional: `CONSULTA_DOC_TOKEN` para autocompletar nombre y dirección desde el DNI o RUC (decolecta.com o apis.net.pe).
3. **Deploy**. Entre con el usuario administrador y complete **Configuración** (RUC, razón social, dirección, código de establecimiento DIGEMID, director técnico, series por caja).

### 3. Facturación electrónica (Nubefact)

1. Cree una cuenta en nubefact.com con el RUC de la botica (tiene modo DEMO para pruebas).
2. En su panel, sección **API (Integración)**, copie la **RUTA** y el **TOKEN** y cárguelos en Vercel.
3. Registre en Nubefact las mismas series que en *Configuración* (por defecto `B001`, `F001`, `BC01`, `FC01`).

Para usar otro PSE/OSE, implemente `ProveedorFacturacion` en `src/lib/facturacion/` y regístrelo en `index.ts`.

### 4. Lector de códigos de barras

- **USB o Bluetooth (modo teclado)**: conéctelo y listo. No requiere configuración; si el lector permite elegir sufijo, deje **Enter** (CR).
- **Celular**: en el teléfono abra `https://<su-dominio>/escaner`, ingrese con el mismo usuario de la caja y permita la cámara. Con el Punto de venta abierto en la PC verá «Celular lector conectado».
- **Cámara de la PC o tablet**: botón de cámara junto al buscador del Punto de venta.

### Atajos del Punto de venta

| Tecla | Acción |
|---|---|
| `F2` | Buscar producto |
| `Enter` / `Shift+Enter` | Agregar por unidad / por caja |
| `↑` `↓` `+` `−` `Supr` | Moverse en el carrito, cambiar cantidad, quitar |
| `F8` | Cambiar unidad → blíster → caja |
| `F6` / `F7` | Ficha del medicamento / genéricos y alternativas |
| `F4` | Cliente (DNI/RUC) |
| `F9` o `Ctrl+Enter` | Cobrar. En el cobro: `E` `D` `C` `Y` `P` `T` eligen el medio y `Enter` confirma |
| `F10` | Reimprimir el último ticket |

## Desarrollo local

```bash
npm install
npx supabase start          # Postgres + Auth locales (Docker)
npx supabase db reset       # aplica migraciones + datos demo (supabase/seed.sql)
cp .env.example .env.local  # con las claves que imprime `supabase start`
npm run dev
```

## Estabilidad

- Las operaciones que mueven stock o dinero son funciones de Postgres transaccionales con bloqueo de filas: no hay correlativos duplicados ni stock negativo aunque vendan varias cajas a la vez.
- Si una pantalla falla, se muestra un aviso con «Reintentar» sin cerrar la sesión ni afectar las demás.
- Indicador de conexión y carrito persistente: un corte de internet no pierde la venta en curso.
- El envío a SUNAT nunca bloquea la atención; los pendientes se reenvían.
- `GET /api/health` sirve para monitoreo externo (UptimeRobot, Better Stack).

## Estructura

```
supabase/migrations/   esquema, lógica de negocio (registrar_venta, registrar_compra, turnos, NC) y reportes
supabase/instalar.sql  las migraciones en un solo archivo para el SQL Editor
supabase/actualizar_etapa2.sql  solo lo nuevo de la etapa 2
src/app/(app)/         pantallas del sistema
src/app/(print)/       ticket y reporte de cierre (80 mm)
src/app/api/           envío SUNAT, reintentos, alta de usuarios, salud
src/lib/facturacion/   adaptadores de facturación electrónica
src/lib/observatorio.ts  archivo del Observatorio de Precios
docs/capturas/         capturas de pantalla
```
