# Brand como tenant vía sales channel — Design

**Fecha:** 2026-09-07
**Estado:** aprobado, pendiente de plan de implementación

## Contexto y problema

Hoy "brand" es una **etiqueta**, no un tenant:

- Una sola instancia de Medusa, una sola base de datos.
- **Un solo sales channel** (`"Tienda Multi-Marca"`) y **una sola publishable key**. Los 6
  productos del seed están linkeados a ese único canal.
- El módulo `brand` + tablas de link (`brand_product`, `brand_customer`,
  `brand_product_category`) son la única capa multi-marca.
- El aislamiento es manual y parcial:
  - Rutas custom (`/store/brands/:slug/products`, `/store/products?brand_id=`) filtran por
    `brand_id` cuando se les pide.
  - `validateCustomerBrand()` compara el header `X-Brand-Id` contra la marca del cliente,
    solo en `/store/customers/me*` y `/store/orders*`.
  - Las rutas **nativas** de Medusa (`/store/products`, `/store/carts`, checkout, todo
    `/admin/*`) no saben qué es una marca.

Consecuencia concreta (pendiente original que dispara este spec): un carrito puede mezclar
productos de dos marcas, y un cliente autenticado a la marca A puede agregar productos de la
marca B. Además `/store/products` nativo devuelve el catálogo de todas las marcas junto.

## Objetivo

Convertir "brand" en un **tenant lógico** (misma DB, misma instancia) para **catálogo y
checkout**, usando el mecanismo nativo de Medusa: **un sales channel + una publishable key
por marca**. La capa de clientes/pedidos (`customer_brand`) se mantiene como está —
Medusa no ofrece tenancy nativa para clientes.

### No-objetivos

- Separación por base de datos o por instancia (eso sería otra arquitectura).
- Tenancy de clientes/pedidos vía sales channel (Medusa no lo soporta; sigue la capa
  `customer_brand`).
- Admin users scopeados por marca.
- Stock location por marca (el almacén sigue compartido).
- Script de migración para data productiva (este entorno es dev y se reseedea libremente;
  el seed cubre el caso dev).

## Modelo de datos

Nuevo link **`brand ↔ sales_channel`**, one-to-one, en
`src/links/brand-sales-channel.ts`:

```ts
import { defineLink } from "@medusajs/framework/utils"
import BrandModule from "../modules/brand"
import SalesChannelModule from "@medusajs/medusa/sales-channel"

export default defineLink(
  { linkable: BrandModule.linkable.brand, isList: false },
  { linkable: SalesChannelModule.linkable.salesChannel, isList: false },
  { readOnly: false }
)
```

Se **conserva** el link `brand ↔ product` (`src/links/brand-product.ts`): lo usan el admin
dashboard, la lógica de categorías, `/store/brands/:slug/products`, `me/brand`. Un producto
queda linkeado a **dos** cosas:

- su **brand** (semántica — de qué marca es el producto)
- el **sales channel de su brand** (visibilidad — qué storefront lo ve)

Sin cambios en `medusa-config.ts`: los sales channels son datos, no configuración.

## Componentes

### 1. Seed (`src/scripts/seed.ts`)

Reemplaza el canal único + key única por **un par canal/key por marca**:

| Brand           | Sales channel (name) | Publishable key (title)      |
|-----------------|----------------------|------------------------------|
| Urban Street    | `Urban Street`       | `Urban Street Storefront`    |
| Classic Threads | `Classic Threads`    | `Classic Threads Storefront` |

Para cada marca, el seed (idempotente, buscando por `name`/`title` antes de crear):

1. Crea el sales channel si no existe.
2. Crea el link `brand ↔ sales_channel` si no existe.
3. Crea la publishable key si no existe y la linkea al canal
   (`linkSalesChannelsToApiKeyWorkflow`).
4. Linkea el canal al stock location compartido `Almacén CDMX`
   (`linkSalesChannelsToStockLocationWorkflow`). El almacén sigue siendo uno solo.

Cambios adicionales en el seed:

- **`updateStoresWorkflow`**: `default_sales_channel_id` apunta al canal de la primera
  marca (Urban Street). Es solo un fallback; los carritos siempre llegan con el canal
  derivado de la publishable key.
- **Paso 4 actual** ("link masivo de productos a un canal"): cambia a linkear cada
  producto al canal **de su marca**, resolviendo el `brand_product` link con `query.graph`
  (`entity: "product", fields: ["id", "brand.id"]`) y agrupando por brand.
- **Summary**: imprime **ambas** publishable keys, etiquetadas por marca.

**Migración de DBs de dev existentes** (idempotente, dentro del propio seed):

- Detecta el canal legacy `"Tienda Multi-Marca"` por nombre.
- Si existe: desvincula todos sus productos
  (`linkProductsToSalesChannelWorkflow` con `remove: [...]`), borra la publishable key que
  solo cuelga de ese canal, y borra el canal.
- Si ya no existe: no hace nada.

> Nota: esto asume que no hay data productiva. Con pedidos/carritos reales apuntando al
> canal viejo haría falta un script de migración dedicado (fuera de alcance).

### 2. Workflow `create-product-with-brand` (`src/workflows/create-product-with-brand.ts`)

Nuevo step **`linkProductToBrandSalesChannelStep`** (con función de compensación que
`dismiss`ea el link), encadenado después de `linkProductToBrandStep`:

1. Recibe `{ product_id, brand_id }`.
2. Resuelve el sales channel de la brand vía el link nuevo
   (`query.graph({ entity: "brand", fields: ["sales_channel.id"], filters: { id: brand_id } })`).
3. Si la brand no tiene canal linkeado → lanza error claro
   (`Brand <id> has no sales channel; run the seed`).
4. Linkea el producto al canal (`linkProductsToSalesChannelWorkflow.runAsStep` o
   `remoteLink.create`).

Sin este step, **todo producto creado desde el admin (`POST /admin/brand-products`) queda
fuera de todos los canales y por lo tanto invisible para todos los storefronts.**

### 3. Rutas store

**Se borran:**

- `src/api/store/products/route.ts`
- `src/api/store/products/[id]/route.ts`
- La entrada de `/store/products` en `src/api/middlewares.ts` y el schema
  `storeProductsQuerySchema` (queda `listProductsQuerySchema` para el admin).

El `GET /store/products` nativo de Medusa ya filtra por el/los sales channel de la
publishable key del request. Los filtros custom que se pierden
(`min_price`/`max_price`/`sizes`/`in_stock`) se anotan como follow-up reimplementable si un
storefront los necesita; `low_stock` es de admin y vive en `/admin/brand-products`, no se
toca. El pendiente "`/store/products?brand_id=` devuelve 400" de `PENDIENTES.md` queda
**obsoleto**.

**Se modifica `src/api/store/brands/[slug]/products/route.ts`:**

- Resuelve el sales channel del request desde el contexto de la publishable key:
  `req.publishable_key_context.sales_channel_ids` (lo setea el middleware nativo
  `ensure-publishable-api-key.js` en `@medusajs/framework`; confirmado en 2.20.1).
- Resuelve la brand de ese canal vía el link `brand ↔ sales_channel`.
- Si el `slug` del path no corresponde a esa brand → `404`.
- El resto de la lógica (query de productos por `brand.id`) queda igual.

**Sin cambios:**

- `src/api/store/brands/route.ts` (lista de marcas activas — solo metadata, sirve para un
  brand-switcher).
- `src/api/store/brands/[slug]/route.ts`.
- `src/api/store/categories/*` — se anota como follow-up scopear las queries filtradas por
  `brand_id` al canal del caller.
- `src/api/store/customers/me/brand/route.ts`.

### 4. Carrito y checkout

**Cero cambios de código.** Comportamiento nativo de Medusa una vez que hay canal por
marca:

- Un carrito creado vía `/store/carts` toma el `sales_channel_id` del contexto de la
  publishable key.
- Agregar un line item (`POST /store/carts/:id/line-items`) de un producto que no está en
  el `sales_channel_id` del carrito lo rechaza Medusa nativamente.

Esto **resuelve el pendiente del carrito multi-marca sin middleware.** El middleware
`validateCartLineItemBrand` que se había bosquejado en la sesión anterior **ya no es
necesario** y no se implementa.

`src/utils/brand-middleware.ts`: `validateCartBrandAccess()` (nunca cableado, pensado para
este caso) se **elimina** — el mecanismo nativo lo reemplaza. `requireBrandId()` y
`optionalBrandId()` se mantienen como utilidades genéricas.

### 5. Capa de clientes / pedidos

Sin cambios. `customer_brand` + `validateCustomerBrand()` + header `X-Brand-Id` siguen
siendo el mecanismo de tenancy para `/store/customers/me*` y `/store/orders*`. Follow-up
anotado: derivar `X-Brand-Id` del canal de la publishable key en vez de exigir el header
explícito.

### 6. Documentación

- **`README.md`**, sección "Configuración de Storefronts": cada storefront usa **su**
  publishable key por marca (no una compartida). `X-Brand-Id` se mantiene para llamadas
  autenticadas de cliente. `NEXT_PUBLIC_BRAND_SLUG` sigue usándose para
  `/store/brands/:slug`.
- **`.env.example`**: nota de que `pnpm run seed` imprime una publishable key por marca al
  final.
- **`PENDIENTES.md`**:
  - Pendiente del carrito multi-marca → **Resuelto** (subsumido por este cambio; nota que
    lo cierra el scoping nativo por canal, no un middleware).
  - Pendiente `/store/products?brand_id= → 400` → **Obsoleto** (ruta custom eliminada).
  - Follow-ups nuevos en la sección de pendientes: scopear `/store/categories*` al canal,
    derivar `X-Brand-Id` del canal, admin users por marca, stock location por marca,
    reimplementar filtros de catálogo si un storefront los pide.

## Impacto en storefronts (fuera de este repo)

Cada storefront Next.js cambia **una** cosa: su
`NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` pasa de la key compartida a la key de su marca (la que
imprime el seed). El header `X-Brand-Id` en llamadas autenticadas y
`NEXT_PUBLIC_BRAND_SLUG` no cambian.

## Verificación

Checklist de curl documentado en `PENDIENTES.md`, al estilo de cómo se verificó el checkout
Stripe/OXXO (no se agrega infra de tests de integración). Con el server corriendo y el seed
aplicado, usando `PK_URBAN` y `PK_CLASSIC` de la salida del seed:

1. `GET /store/products` con `PK_URBAN` → solo productos de Urban Street; con `PK_CLASSIC`
   → solo Classic Threads.
2. `GET /store/products/:id` (nativo) de un producto de Classic con `PK_URBAN` → `404`.
3. Carrito con `PK_URBAN`:
   - crear carrito → `sales_channel_id` = canal de Urban Street.
   - agregar variante de Urban Street → `200`.
   - agregar variante de Classic Threads al mismo carrito → error de Medusa (producto fuera
     del canal del carrito).
4. Checkout completo con `PK_URBAN` (cart → shipping → payment `pp_system_default` →
   complete) → orden generada. Regresión del flujo ya verificado en `PENDIENTES.md`.
5. `POST /admin/brand-products` creando un producto para Urban Street → aparece en
   `GET /store/products` con `PK_URBAN`, no con `PK_CLASSIC`.
6. `GET /store/brands/classic-threads/products` con `PK_URBAN` → `404` (tras el scoping de
   esa ruta).

## Riesgos y consideraciones

- **Contexto de publishable key**: `req.publishable_key_context.sales_channel_ids` está
  confirmado en 2.20.1 (`@medusajs/framework/dist/http/middlewares/ensure-publishable-api-key.js`).
  Solo está presente si la ruta pasó por ese middleware nativo (todas las `/store/*` lo
  hacen); si llegara vacío, la ruta debe responder `400`.
- **Idempotencia del seed contra DBs viejas**: la lógica de borrado del canal legacy debe
  tolerar que ya no exista y que la publishable key vieja ya esté desvinculada.
- **`default_sales_channel_id` del store**: apuntarlo a un canal de marca es un fallback
  aceptable; documentar que no debería usarse en la práctica.
- **Productos sin brand**: si existiera un producto sin `brand_product` link (no debería
  con el workflow actual), el seed no lo linkearía a ningún canal y quedaría invisible. El
  seed loguea un warning con la lista de esos productos.
