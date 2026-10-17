# Marca = sales channel nativo — Design

**Fecha:** 2026-10-17
**Estado:** implementado

## Contexto y problema

Principio acordado: **en Medusa se usa todo lo nativo**. Lo único propio es el control plane,
que guarda la configuración y el orden de los tenants (ver
`2026-10-16-tenant-provisionable-medusa-design.md`).

Hoy la marca es un módulo propio (`src/modules/brand`, tabla `brand`) ligado 1:1 a un sales
channel (`src/links/brand-sales-channel.ts`) y a cada producto (`src/links/brand-product.ts`).
Eso duplica lo que el sales channel ya hace (aislar catálogo, carrito y publishable key) y
rompe pantallas nativas. El caso que lo destapó: PR #11 exige `additional_data.brand_id` al
crear productos, y el formulario nativo del admin nunca lo manda, así que ya no puede crear
productos.

## Objetivo

Que **una marca sea un sales channel**, sin entidad propia:

- Todo sales channel del tenant es una marca. El canal default del store
  (`store.default_sales_channel_id`) es la marca default: la primera y, en muchos tenants, la
  única.
- Los datos de la marca viven en el propio canal: `name`, `description`, `is_disabled`, y el
  resto en `metadata`.
- La marca de un producto es su sales channel. El formulario nativo de crear producto vuelve a
  funcionar tal cual: preselecciona el canal default, que ya es una marca.

### No-objetivos (fase 2 o aparte)

- Sustituir el módulo `category` propio por las product categories nativas. En esta fase solo
  se reapunta su `brand_id` a `sales_channel_id`.
- Sustituir `product-extension` (SKU, tallas) por variantes y opciones nativas.
- Varios canales por marca (web, POS, app). Con marca = canal no aplica; si algún día hace
  falta, es otro diseño.
- Clientes compartidos entre marcas de un tenant (`customer_brand` N:M).
- Migrar datos de tenants en producción: todavía no hay ninguno. El tenant #1 en local se
  resiembra.

## Modelo

### Marca en el sales channel

| Dato de marca | Dónde vive | Dueño |
|---|---|---|
| nombre | `sales_channel.name` | control plane |
| activa | `sales_channel.is_disabled` (invertido) | control plane |
| slug (identidad) | `metadata.brand_slug` | control plane |
| descripción | `sales_channel.description` | cliente (se siembra al crear) |
| logo | `metadata.brand_logo_url` | cliente (se siembra al crear) |
| color primario | `metadata.brand_primary_color` | cliente (se siembra al crear) |
| color secundario | `metadata.brand_secondary_color` | cliente (se siembra al crear) |

Las claves son planas y con prefijo `brand_` para que el editor nativo de metadata del admin
las muestre y edite sin JSON anidado.

Un helper de solo lectura, `src/brand/channel-brand.ts`, da forma tipada a esto:
`brandFromChannel(channel)` (lee el canal y su metadata) y `BRAND_METADATA_KEYS`. No es un
modelo ni toca la DB.

### Marca default

- La config del tenant marca **exactamente una** marca con `default: true`. El schema lo valida.
- El apply liga esa marca al canal de `store.default_sales_channel_id`, que crea
  `applyInitialDefaults` en el primer apply. Si el canal ya existe sin `brand_slug`, el apply lo
  adopta: le pone nombre, slug y apariencia.
- Reordenar la lista de marcas en el control plane no cambia de canal: la identidad es el
  slug, no la posición.
- La marca default no se puede desactivar ni quitar de la config, porque Medusa usa ese canal
  como fallback. El schema rechaza `default: true` con `active: false`. Cambiar cuál es la
  default (mover `default: true` a otra marca) actualiza `store.default_sales_channel_id`.

### Producto

La marca del producto es su sales channel. Regla: **todo producto está en exactamente un
canal**.

- Se valida en el hook nativo `createProductsWorkflow.hooks.productsCreated`. Medusa liga los
  canales antes de ejecutar el hook (`associateProductsWithSalesChannelsStep`), así que el hook
  ve el estado final. Si un producto queda con 0 o con más de 1 canal, el hook lanza y Medusa
  revierte la creación. Esto cubre el formulario nativo, `POST /admin/products`, el batch y la
  importación CSV, sin bloquear ninguna de esas vías.
- Lo mismo en `updateProductsWorkflow.hooks.productsUpdated`, para ediciones de canales desde la
  pantalla del producto.
- `POST /admin/sales-channels/:id/products` (agregar productos desde la pantalla del canal) no
  tiene hook. Un middleware rechaza con 400 si alguno de los productos que se agregan ya está
  en otro canal.
- Se borran `requireProductBrand`, `rejectUnbrandedProductCreate`, el hook actual
  `src/workflows/hooks/products-created.ts` (ya no hay link que crear) y
  `src/workflows/create-product-with-brand.ts`.

## Componentes

### Se borra

- `src/modules/brand/` (modelo, servicio, migraciones) y su registro en `medusa-config.ts`.
- Links: `brand-product.ts`, `brand-sales-channel.ts`, `brand-customer.ts` y
  `brand-product-category.ts`. Este último no lo usa ningún código.
- `src/subscribers/brand-created.ts`.
- `src/workflows/create-product-with-brand.ts` y `src/workflows/hooks/products-created.ts`.
- `src/api/admin/brands/**` y `src/admin/routes/brands/**`.
- Rutas de producto propias que duplican el admin nativo: `src/api/admin/brand-products/**` y
  `src/admin/routes/brand-products/**`. El admin nativo ya lista y edita productos con su canal.
  Entran en esta fase y no en la 2 porque dependen del link producto↔marca: reescribirlas cuesta
  más que borrarlas.
- Widgets que duplican filtros nativos por canal: `brand-selector`, `product-brand-filter`,
  `order-brand-filter` y `product-brand-info`. Los pedidos y productos nativos ya muestran y
  filtran por sales channel.
- `src/api/store/brands/**`. Lo sustituye `GET /store/brand` (abajo).
- Del middleware: `requireBrandId`, `optionalBrandId` y `extractBrandId` (sin uso).

### Se reapunta al canal

- **`src/tenant/config-schema.ts`:** `brandSchema` gana `default: boolean` (exactamente una).
  El resto del schema no cambia; el control plane sigue hablando de "marcas".
- **`src/tenant/sync-brands.ts`:** busca los canales por `metadata.brand_slug` en lugar de por
  la tabla `brand`. Crea, actualiza, desactiva y adopta el canal default. Escribe la apariencia
  en metadata solo al crear el canal, igual que hoy. Conserva la lógica de publishable keys,
  almacenes y deshacer lo creado si falla.
- **`src/tenant/invariants.ts`:** las mismas comprobaciones, leídas de canales. Agrega:
  - el canal de `store.default_sales_channel_id` tiene `brand_slug`;
  - no hay dos canales con el mismo `brand_slug`;
  - todo canal tiene `brand_slug` (reporta los creados fuera de la config, no los borra);
  - todo producto está en exactamente un canal.
- **`src/utils/brand-middleware.ts`:**
  - `resolveCallerBrand` devuelve la marca del canal de la publishable key
    (`brandFromChannel`).
  - `validateCartLineItemBrand` y `validateCartCreateBrand` comprueban que el producto de cada
    variante esté en el canal del carrito. Sigue haciendo falta: Medusa 2.20.1 no lo valida
    (verificado 2026-09-07).
  - `validateCustomerBrand` compara `customer_brand.sales_channel_id` con el canal de la
    publishable key.
- **`src/modules/customer-brand`:** la columna `brand_id` pasa a `sales_channel_id` (nueva
  migración). Se queda como módulo propio, no como `customer.metadata`, porque el cliente puede
  editar su propia metadata desde `POST /store/customers/me` y se cambiaría de marca.
- **`src/subscribers/customer-created.ts`:** toma el canal de
  `customer.metadata.sales_channel_id` (antes `brand_id`). Valida que el canal exista y tenga
  `brand_slug`.
- **`src/api/store/customers/me/brand`:** devuelve la marca a partir de
  `customer_brand.sales_channel_id`.
- **Módulo `category`:** `brand_id` pasa a `sales_channel_id` (migración) y las rutas
  `/store/categories*` y `/admin/categories*` se ajustan. `getCategoryTreeForBrand` toma un
  canal.
- **`src/api/admin/dashboard/metrics`:** agrupa por canal. Pedidos por `order.sales_channel_id`
  (nativo y directo, sin pasar por `items → product → brand`), y productos e inventario por
  `product.sales_channels`. Los widgets `dashboard-metrics` y `low-stock-alert` se quedan, con el selector de marca leyendo la lista de canales nativa (`GET /admin/sales-channels`).
- **`src/workflows/add-variant-to-product.ts`:** quita la dependencia de la marca.
- **`src/scripts/seed-demo.ts` y `verify-tenant-apply.ts`:** config de demo con Urban Street como
  `default: true` y Classic Threads como segunda marca.

### Nuevo (mínimo)

- **`GET /store/brand`:** devuelve la marca del canal de la publishable key (nombre, slug,
  descripción, logo y colores). El storefront lo necesita para pintarse, y Medusa no expone el
  sales channel en la Store API. Sustituye a `/store/brands*`.
- **Widget de apariencia** en la zona nativa `sales_channel.details.after`: un formulario con
  descripción, logo y colores que guarda vía la ruta nativa
  `POST /admin/sales-channels/:id` (`description` y `metadata`). Sustituye a la pantalla propia
  de marca de `ab28d15`. Ninguna API propia.
- **Guarda de campos del control plane** (middleware en rutas nativas):
  - `POST /admin/sales-channels`: 400. Los canales los crea el control plane.
  - `DELETE /admin/sales-channels/:id`: 400.
  - `POST /admin/sales-channels/:id`: 400 si cambia `name`, `is_disabled` o
    `metadata.brand_slug`. Pasan `description` y el resto de la metadata.

  Esta guarda reproduce el "solo lectura salvo apariencia" de `ab28d15` sobre las pantallas
  nativas. Aun sin ella, el siguiente apply restauraría lo que el control plane posee.

## Flujos

**Crear producto (admin nativo):** se abre el formulario, que preselecciona el canal default (la
marca default) → se guarda → el hook `productsCreated` ve un canal → ok. En un tenant de varias
marcas, el admin cambia el canal a "Classic Threads" antes de guardar. Si deja dos canales, el
hook lanza un error con un mensaje claro y Medusa revierte.

**Apply de tenant:** `applyInitialDefaults` (solo en el primer apply) crea el store y su canal
default → `syncBrands` adopta el canal default para la marca `default: true` y crea o
actualiza el resto por `brand_slug` → la respuesta lleva `sales_channel_id` y la publishable
key por marca, igual que hoy.

**Storefront:** con su publishable key llama a `GET /store/brand` para pintarse, y al resto de
la Store API nativa (`/store/products`, ya scopeada por el canal de la key).

## Manejo de errores

- **Hook de producto:** `MedusaError.INVALID_DATA` con el título del producto y el número de
  canales.
- **Apply:** un `brand_slug` duplicado en DB o la falta del canal default lanza antes de
  modificar nada. El rollback de lo creado sigue como hoy (`undoCreatedBrands`, ahora sobre
  canales y keys).
- **Middleware de carrito:** falla cerrado, como hoy.

## Verificación

No hay jest instalado; la verificación sigue siendo `medusa build`, los probes con
`medusa exec` y curl:

1. `npx medusa build` y `tsc --noEmit` con 0 errores.
2. DB nueva + `seed-demo` + `verify-tenant-apply`: todas las invariantes en ok, incluidas las
   nuevas.
3. Crear un producto desde el formulario nativo en `/app` sin tocar nada: queda en Urban Street.
4. Crear un producto con dos canales: el admin muestra el error y el producto no se crea.
5. Agregar un producto de Urban Street al canal de Classic Threads desde la pantalla del canal:
   400.
6. Cambiar el nombre de un canal desde el admin: 400. Cambiar el logo desde el widget: ok.
7. Regresiones con curl, con cada publishable key: `GET /store/brand`, `/store/products`,
   carrito mezclando marcas (403), login de cliente y `/store/customers/me/brand` con la marca
   correcta (200) e incorrecta (403), y checkout completo con el provider manual.
8. Un segundo apply con la misma config no cambia nada (idempotente). Un apply con la marca
   default cambiada actualiza `store.default_sales_channel_id`.

## Riesgos

- **Tablas huérfanas:** quitar el módulo `brand` y sus links no borra sus tablas de la DB.
  En local se resiembra en una DB nueva. Como no hay tenants en producción, no se escribe
  migración de borrado. Si al implementar sí hubiera datos, se usaría `npx medusa db:sync-links`
  para los links.
- **Canal elegido al registrarse:** `customer-created` confía en el
  `metadata.sales_channel_id` que manda el storefront al registrar al cliente, igual que hoy con
  `brand_id`. No empeora, pero queda anotado: lo correcto sería derivarlo de la publishable key
  del registro.
- **Metadata editable a mano:** el editor nativo de metadata podría tocar `brand_slug`. La
  guarda lo bloquea y la invariante lo reporta.
- **Fricción en tenants de varias marcas:** el formulario preselecciona siempre el canal default.
  Se acepta para no escribir UI.

## Desviaciones al implementar

- `create-product-with-brand` se renombró a `create-apparel-product` (el seed necesita generar SKU y variantes).
- `add-variant-to-product` se borró (su único caller, `/admin/brand-products`, se borró).
- `low-stock-alert` y el selector de marca del dashboard se borraron (dependían de APIs eliminadas); el conteo de stock bajo por marca sigue en las métricas.
- Se agregó una guarda de publishable keys (`POST /admin/api-keys/:id/sales-channels`) y el apply repara keys enlazadas a más de un canal de marca.
