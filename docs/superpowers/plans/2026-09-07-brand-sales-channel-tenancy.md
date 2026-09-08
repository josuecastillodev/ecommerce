# Brand como tenant vía sales channel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir "brand" en un tenant lógico para catálogo y checkout dándole a cada marca su propio sales channel + publishable key, de modo que el scoping nativo de Medusa aísle productos y carritos.

**Architecture:** Misma DB, misma instancia. Un link nuevo `brand ↔ sales_channel` (1:1). El seed crea un canal + una publishable key por marca y linkea cada producto al canal de su marca. El workflow de creación de producto hace ese linkeo automáticamente. Se borran las rutas `/store/products` custom (el nativo ya scopea por el canal de la pub key) y se scopea `/store/brands/:slug/products` al canal del request. Carrito y checkout no cambian: Medusa rechaza nativamente line items fuera del canal del carrito.

**Tech Stack:** Medusa.js 2.20.1, TypeScript, `@medusajs/framework` workflows-sdk, `@medusajs/medusa/core-flows`, Postgres, pnpm.

## Global Constraints

- Dependencias: solo `pnpm`. No agregar dependencias nuevas (este plan no necesita ninguna).
- Precios en **decimal** (unidad mayor), nunca centavos — convención confirmada de la rama.
- El seed (`pnpm run seed`) debe quedar **idempotente**: corre 2+ veces sin duplicar ni fallar.
- Mensajes de commit cortos, formato `tipo: mensaje` (feat/fix/docs/chore), en español, sin créditos de autoría.
- No hay infra de tests de integración; la verificación es vía `npx medusa exec` (probe script) y `curl`, con resultados anotados en `PENDIENTES.md`.
- Node 20 o 22 (`.nvmrc` = 22.9.0).
- Los dos sales channels se llaman **exactamente** `Urban Street` y `Classic Threads`. Las dos publishable keys se titulan **exactamente** `Urban Street Storefront` y `Classic Threads Storefront`.

---

## File Structure

**Nuevos:**
- `src/links/brand-sales-channel.ts` — link 1:1 `brand ↔ sales_channel`.
- `src/scripts/verify-brand-channels.ts` — probe idempotente que asevera las invariantes de tenancy y loguea un reporte (se corre con `npx medusa exec`).

**Modificados:**
- `src/scripts/seed.ts` — canal + key por marca; linkeo de productos por marca; limpieza de canales legacy; summary con ambas keys.
- `src/workflows/create-product-with-brand.ts` — step nuevo `linkProductToBrandSalesChannelStep`.
- `src/api/middlewares.ts` — quitar el matcher `/store/products` y el schema `storeProductsQuerySchema`.
- `src/api/store/brands/[slug]/products/route.ts` — scopear al canal de la publishable key del request.
- `src/utils/brand-middleware.ts` — eliminar `validateCartBrandAccess()`.
- `README.md` — sección de storefronts: pub key por marca.
- `.env.example` — nota de las dos pub keys que imprime el seed.
- `PENDIENTES.md` — mover resueltos/obsoletos, agregar follow-ups, agregar checklist de verificación con resultados.

**Borrados:**
- `src/api/store/products/route.ts`
- `src/api/store/products/[id]/route.ts`

---

### Task 1: Link `brand ↔ sales_channel`

**Files:**
- Create: `src/links/brand-sales-channel.ts`

**Interfaces:**
- Consumes: nada.
- Produces: un link que hace navegable `brand.sales_channel` (singular, `isList: false`) en `query.graph({ entity: "brand", fields: ["sales_channel.id"] })`, y `sales_channel.brand` en sentido inverso.

- [ ] **Step 1: Crear el archivo del link**

`src/links/brand-sales-channel.ts`:

```ts
import { defineLink } from "@medusajs/framework/utils"
import BrandModule from "../modules/brand"
import SalesChannelModule from "@medusajs/medusa/sales-channel"

/**
 * Link Brand <-> SalesChannel (1:1)
 * Cada marca tiene exactamente un sales channel; ese canal es lo que aísla
 * el catálogo y el carrito por storefront (tenancy nativa de Medusa).
 */
export default defineLink(
  {
    linkable: BrandModule.linkable.brand,
    isList: false,
  },
  {
    linkable: SalesChannelModule.linkable.salesChannel,
    isList: false,
  },
  {
    readOnly: false,
  }
)
```

- [ ] **Step 2: Sincronizar el link a la base de datos**

Run: `npx medusa db:migrate`
Expected: termina sin error e imprime una línea de sync de links que menciona `brand_sales_channel` (o `brand_brand_sales_channel_sales_channel`). Sin errores de "cannot resolve linkable".

- [ ] **Step 3: Probar que el campo es navegable**

Run:
```bash
npx medusa exec ./src/scripts/verify-brand-channels.ts
```
Expected: **falla** con un mensaje del tipo `[verify] FAIL: brand "Urban Street" no tiene sales_channel linkeado` (el script existe recién en el Task 2 — este step se marca cuando el Task 2 crea el script; si se ejecuta el Task 1 aislado, basta con confirmar en Step 2 que la migración corre). Si el script todavía no existe, correr en su lugar:
```bash
node -e "console.log('link file present:', require('fs').existsSync('src/links/brand-sales-channel.ts'))"
```
Expected: `link file present: true`

- [ ] **Step 4: Commit**

```bash
git add src/links/brand-sales-channel.ts
git commit -m "feat: link brand con sales channel (1:1)"
```

---

### Task 2: Seed — un sales channel + una publishable key por marca

**Files:**
- Modify: `src/scripts/seed.ts`
- Create: `src/scripts/verify-brand-channels.ts`

**Interfaces:**
- Consumes: el link de Task 1 (`brand.sales_channel`).
- Produces:
  - Tras `pnpm run seed`: existen sales channels `Urban Street` y `Classic Threads`; cada uno linkeado a su brand, a una publishable key homónima (`<Marca> Storefront`) y al stock location `Almacén CDMX`; cada producto está linkeado al sales channel de su marca (vía `brand_product`); ningún producto queda linkeado a un canal que no sea el de su marca.
  - `src/scripts/verify-brand-channels.ts`: default export `async ({ container }: ExecArgs) => void` que lanza `Error` si alguna invariante falla, y loguea `[verify] OK ...` por invariante cumplida.

- [ ] **Step 1: Escribir el probe de verificación (falla primero)**

Create `src/scripts/verify-brand-channels.ts`:

```ts
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const BRAND_CHANNELS: Record<string, string> = {
  "urban-street": "Urban Street",
  "classic-threads": "Classic Threads",
}
const KEY_TITLES: Record<string, string> = {
  "Urban Street": "Urban Street Storefront",
  "Classic Threads": "Classic Threads Storefront",
}

export default async function verifyBrandChannels({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const apiKeyModule = container.resolve(Modules.API_KEY)

  const failures: string[] = []
  const ok = (msg: string) => logger.info(`[verify] OK ${msg}`)
  const fail = (msg: string) => {
    failures.push(msg)
    logger.error(`[verify] FAIL: ${msg}`)
  }

  // 1. Cada brand tiene su sales channel con el nombre correcto.
  const { data: brands } = await query.graph({
    entity: "brand",
    fields: ["id", "name", "slug", "sales_channel.id", "sales_channel.name"],
  })

  const channelIdByBrandSlug: Record<string, string> = {}

  for (const [slug, expectedName] of Object.entries(BRAND_CHANNELS)) {
    const brand = brands.find((b: any) => b.slug === slug)
    if (!brand) {
      fail(`no existe la brand con slug "${slug}"`)
      continue
    }
    if (!brand.sales_channel?.id) {
      fail(`brand "${brand.name}" no tiene sales_channel linkeado`)
      continue
    }
    if (brand.sales_channel.name !== expectedName) {
      fail(
        `brand "${brand.name}" linkeada al canal "${brand.sales_channel.name}", se esperaba "${expectedName}"`
      )
      continue
    }
    channelIdByBrandSlug[slug] = brand.sales_channel.id
    ok(`brand "${brand.name}" -> canal "${expectedName}"`)
  }

  // 2. Cada canal tiene su publishable key homónima.
  for (const [channelName, keyTitle] of Object.entries(KEY_TITLES)) {
    const [key] = await apiKeyModule.listApiKeys({
      title: keyTitle,
      type: "publishable",
    })
    if (!key) {
      fail(`no existe la publishable key "${keyTitle}"`)
      continue
    }
    const { data: keyChannels } = await query.graph({
      entity: "api_key",
      fields: ["id", "sales_channels.id", "sales_channels.name"],
      filters: { id: key.id },
    })
    const linked = keyChannels[0]?.sales_channels ?? []
    const names = linked.map((c: any) => c.name)
    if (names.length !== 1 || names[0] !== channelName) {
      fail(
        `publishable key "${keyTitle}" linkeada a [${names.join(", ")}], se esperaba solo "${channelName}"`
      )
      continue
    }
    ok(`key "${keyTitle}" -> canal "${channelName}"`)
  }

  // 3. Cada producto está SOLO en el canal de su marca.
  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "brand.slug",
      "brand.name",
      "sales_channels.id",
      "sales_channels.name",
    ],
  })

  for (const p of products as any[]) {
    const brandSlug = p.brand?.slug
    if (!brandSlug) {
      fail(`producto "${p.title}" no tiene brand linkeada`)
      continue
    }
    const expectedChannelId = channelIdByBrandSlug[brandSlug]
    const channelIds = (p.sales_channels ?? []).map((c: any) => c.id)
    if (!expectedChannelId) {
      fail(`producto "${p.title}" pertenece a brand "${brandSlug}" sin canal`)
      continue
    }
    if (channelIds.length !== 1 || channelIds[0] !== expectedChannelId) {
      const chNames = (p.sales_channels ?? []).map((c: any) => c.name).join(", ")
      fail(
        `producto "${p.title}" (${p.brand.name}) en canales [${chNames}], se esperaba solo el de su marca`
      )
      continue
    }
  }
  if (!(products as any[]).some((p) => !p.brand?.slug)) {
    ok(`los ${products.length} productos están cada uno solo en el canal de su marca`)
  }

  if (failures.length > 0) {
    throw new Error(
      `[verify] ${failures.length} invariante(s) de tenancy fallaron:\n- ${failures.join("\n- ")}`
    )
  }
  logger.info("[verify] Todas las invariantes de tenancy se cumplen.")
}
```

- [ ] **Step 2: Correr el probe para verlo fallar**

Run: `npx medusa exec ./src/scripts/verify-brand-channels.ts`
Expected: lanza `Error [verify] ... invariante(s) de tenancy fallaron` mencionando que las brands no tienen `sales_channel` linkeado (el seed todavía no lo crea).

- [ ] **Step 3: Reescribir el bloque de sales channel en `seed.ts` (sección 0)**

En `src/scripts/seed.ts`, **reemplazar** el bloque actual de sales channel (el `let [salesChannel] = await salesChannelModule.listSalesChannels(...)` con su `if (!salesChannel) { createSalesChannelsWorkflow ... }`) por esto — deja que Medusa conserve su canal por defecto y lo usa solo como default del store:

```ts
  // Sales channel por defecto del store — Medusa crea uno en el primer boot.
  // NO se usa para storefronts (no lleva publishable key); solo es el fallback
  // del store. Los canales de marca se crean más abajo, después de las brands.
  let [defaultSalesChannel] = await salesChannelModule.listSalesChannels(
    {},
    { take: 1, order: { created_at: "ASC" } }
  )
  if (!defaultSalesChannel) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ name: "Default Sales Channel" }] },
    })
    defaultSalesChannel = result[0]
    logger.info("Created default sales channel")
  }
```

Luego, en el bloque `updateStoresWorkflow` que le sigue, cambiar `default_sales_channel_id: salesChannel.id` por `default_sales_channel_id: defaultSalesChannel.id`.

- [ ] **Step 4: Quitar el linkeo del canal default al stock location y a la api key**

En `seed.ts`, **eliminar** estas dos llamadas (se re-harán por marca en el Step 6):

```ts
  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: stockLocation.id, add: [salesChannel.id] },
  })
```

y todo el bloque de publishable key única:

```ts
  // Publishable API key — required for every /store/* request.
  let [publishableKey] = await apiKeyModule.listApiKeys({ type: "publishable" })
  if (!publishableKey) {
    const { result } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [
          { title: "Storefront", type: "publishable", created_by: "seed" },
        ],
      },
    })
    publishableKey = result[0]
    logger.info("Created publishable API key")
  }
  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: { id: publishableKey.id, add: [salesChannel.id] },
  })
```

- [ ] **Step 5: Añadir helper de imports en `seed.ts`**

Confirmar que el bloque de import de `@medusajs/medusa/core-flows` ya incluye `createSalesChannelsWorkflow`, `createApiKeysWorkflow`, `linkSalesChannelsToApiKeyWorkflow`, `linkSalesChannelsToStockLocationWorkflow`, `linkProductsToSalesChannelWorkflow` (todos ya están). Añadir el import del `LINK` remoto si no está: al inicio de `seed()` ya existe `const link = container.resolve(ContainerRegistrationKeys.LINK)` — reutilizarlo.

- [ ] **Step 6: Crear la sección "1b. Sales channels + keys por marca" en `seed.ts`**

Insertar **justo después** del `for (const brandData of brandsData) { ... }` que llena `brands`, y **antes** de `// 2. Create Categories`:

```ts
  // ============================================================
  // 1b. Un sales channel + una publishable key por marca
  // ============================================================
  logger.info("Seeding per-brand sales channels + publishable keys...")

  const BRAND_CHANNELS: Record<string, string> = {
    "urban-street": "Urban Street",
    "classic-threads": "Classic Threads",
  }

  // brandSlug -> { channelId, keyToken }
  const brandChannels: Record<string, { channelId: string; keyToken: string }> = {}

  for (const [slug, channelName] of Object.entries(BRAND_CHANNELS)) {
    const brand = brands[slug]
    if (!brand) {
      logger.error(`Cannot create channel: brand "${slug}" missing`)
      continue
    }

    // 1. Sales channel (idempotente por nombre).
    let [channel] = await salesChannelModule.listSalesChannels({ name: channelName })
    if (!channel) {
      const { result } = await createSalesChannelsWorkflow(container).run({
        input: { salesChannelsData: [{ name: channelName }] },
      })
      channel = result[0]
      logger.info(`Created sales channel: ${channelName}`)
    }

    // 2. Link brand <-> sales channel (idempotente).
    const { data: linkedBrand } = await query.graph({
      entity: "brand",
      fields: ["id", "sales_channel.id"],
      filters: { id: brand.id },
    })
    if (linkedBrand[0]?.sales_channel?.id !== channel.id) {
      await safeLink(() =>
        link.create({
          [BRAND_MODULE]: { brand_id: brand.id },
          [Modules.SALES_CHANNEL]: { sales_channel_id: channel.id },
        })
      )
      logger.info(`Linked brand ${channelName} <-> its sales channel`)
    }

    // 3. Link canal <-> stock location compartido (idempotente vía workflow).
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: stockLocation.id, add: [channel.id] },
    })

    // 4. Publishable key homónima (idempotente por título).
    const keyTitle = `${channelName} Storefront`
    let [pubKey] = await apiKeyModule.listApiKeys({
      title: keyTitle,
      type: "publishable",
    })
    if (!pubKey) {
      const { result } = await createApiKeysWorkflow(container).run({
        input: {
          api_keys: [
            { title: keyTitle, type: "publishable", created_by: "seed" },
          ],
        },
      })
      pubKey = result[0]
      logger.info(`Created publishable key: ${keyTitle}`)
    }
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: { id: pubKey.id, add: [channel.id] },
    })

    brandChannels[slug] = { channelId: channel.id, keyToken: pubKey.token }
  }
```

- [ ] **Step 7: Reemplazar la sección 4 (linkeo masivo de productos) por linkeo por marca + limpieza de canales legacy**

En `seed.ts`, **reemplazar** el bloque actual:

```ts
  const { data: allProducts } = await query.graph({
    entity: "product",
    fields: ["id"],
  })
  if (allProducts.length > 0) {
    await linkProductsToSalesChannelWorkflow(container).run({
      input: { id: salesChannel.id, add: allProducts.map((p: any) => p.id) },
    })
    logger.info(`Linked ${allProducts.length} products to the sales channel`)
  }
```

por:

```ts
  // Linkear cada producto al sales channel de SU marca (idempotente) y
  // sacarlo de cualquier otro canal (limpieza de estados legacy donde todos
  // los productos colgaban de un canal compartido).
  const { data: allProducts } = await query.graph({
    entity: "product",
    fields: ["id", "title", "brand.slug", "sales_channels.id"],
  })

  // Set de channelIds "válidos" = los de marca.
  const brandChannelIds = new Set(
    Object.values(brandChannels).map((bc) => bc.channelId)
  )

  const productsWithoutBrand: string[] = []

  for (const p of allProducts as any[]) {
    const slug = p.brand?.slug
    const target = slug ? brandChannels[slug]?.channelId : undefined
    if (!target) {
      productsWithoutBrand.push(p.title)
      continue
    }
    const current: string[] = (p.sales_channels ?? []).map((c: any) => c.id)
    const toAdd = current.includes(target) ? [] : [target]
    const toRemove = current.filter((id) => id !== target)
    if (toAdd.length || toRemove.length) {
      await linkProductsToSalesChannelWorkflow(container).run({
        input: { id: target, add: [p.id], remove: [] },
      })
      for (const staleChannelId of toRemove) {
        await linkProductsToSalesChannelWorkflow(container).run({
          input: { id: staleChannelId, add: [], remove: [p.id] },
        })
      }
    }
  }

  logger.info(
    `Linked ${allProducts.length - productsWithoutBrand.length} products to their brand channel`
  )
  if (productsWithoutBrand.length > 0) {
    logger.warn(
      `Products without a brand link (left out of every channel): ${productsWithoutBrand.join(", ")}`
    )
  }
```

> Nota de diseño (refinamiento sobre el spec): el spec decía "borrar el canal legacy y su key". Borrar un sales channel con links puede fallar; en su lugar los productos se **sacan** del canal legacy (cero fuga) y el canal vacío se deja como huérfano inofensivo — mismo criterio que el repo ya aplica con la fila `pp_stripe-mexico` (ver memoria). El `default_sales_channel_id` del store apunta a ese canal default, que es lo que Medusa espera.

- [ ] **Step 8: Actualizar el summary del seed**

**Reemplazar** la línea:

```ts
  logger.info(`  - Publishable API key: ${publishableKey.token}`)
```

por:

```ts
  for (const [slug, bc] of Object.entries(brandChannels)) {
    logger.info(`  - Publishable key [${BRAND_CHANNELS[slug]}]: ${bc.keyToken}`)
  }
```

- [ ] **Step 9: Correr el seed dos veces (idempotencia)**

Run:
```bash
docker-compose up -d postgres redis
pnpm run seed && pnpm run seed
```
Expected: ambas corridas terminan con `Seed process completed!`. La segunda no crea nada nuevo (logs de "already exists"). El summary imprime dos líneas `Publishable key [Urban Street]: pk_...` y `Publishable key [Classic Threads]: pk_...`.

- [ ] **Step 10: Correr el probe de verificación**

Run: `npx medusa exec ./src/scripts/verify-brand-channels.ts`
Expected: `[verify] Todas las invariantes de tenancy se cumplen.` y ningún `[verify] FAIL`.

- [ ] **Step 11: Commit**

```bash
git add src/scripts/seed.ts src/scripts/verify-brand-channels.ts
git commit -m "feat: seed crea un sales channel y publishable key por marca"
```

---

### Task 3: El workflow de producto linkea al canal de la marca

**Files:**
- Modify: `src/workflows/create-product-with-brand.ts`

**Interfaces:**
- Consumes: link `brand.sales_channel` (Task 1); `linkProductsToSalesChannelWorkflow` de core-flows.
- Produces: tras `createProductWithBrandWorkflow.run({ input })`, el producto creado queda linkeado al sales channel de `input.brand_id`. La forma del `WorkflowResponse` (objeto producto + `.brand`) no cambia.

- [ ] **Step 1: Añadir el import de `linkProductsToSalesChannelWorkflow`**

En `src/workflows/create-product-with-brand.ts`, en el import de `@medusajs/medusa/core-flows`:

```ts
import {
  createProductsWorkflow,
  linkProductsToSalesChannelWorkflow,
} from "@medusajs/medusa/core-flows"
```

- [ ] **Step 2: Añadir el step `linkProductToBrandSalesChannelStep`**

Justo después de `linkProductToBrandStep` (antes de `buildVariantOptions`):

```ts
// Step: Link product to its brand's sales channel.
// Sin esto el producto queda fuera de todo sales channel y ningún storefront
// (que consulta con su publishable key) lo ve.
const linkProductToBrandSalesChannelStep = createStep(
  "link-product-to-brand-sales-channel",
  async (
    input: { product_id: string; brand_id: string },
    { container }
  ) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: brands } = await query.graph({
      entity: "brand",
      fields: ["id", "sales_channel.id"],
      filters: { id: input.brand_id },
    })

    const channelId = brands[0]?.sales_channel?.id
    if (!channelId) {
      throw new Error(
        `Brand ${input.brand_id} has no sales channel linked. Run "pnpm run seed" to provision per-brand channels.`
      )
    }

    await linkProductsToSalesChannelWorkflow(container).run({
      input: { id: channelId, add: [input.product_id], remove: [] },
    })

    return new StepResponse({ product_id: input.product_id, channel_id: channelId })
  },
  async (data, { container }) => {
    if (!data) return
    await linkProductsToSalesChannelWorkflow(container).run({
      input: { id: data.channel_id, add: [], remove: [data.product_id] },
    })
  }
)
```

- [ ] **Step 3: Encadenar el step en el workflow**

En el cuerpo de `createProductWithBrandWorkflow`, después de la llamada existente a `linkProductToBrandStep({ product_id: productId, brand_id: input.brand_id })`, añadir:

```ts
    linkProductToBrandSalesChannelStep({
      product_id: productId,
      brand_id: input.brand_id,
    })
```

- [ ] **Step 4: Verificar con un producto nuevo vía admin**

Run (requiere admin user — crear si no existe con `npx medusa user -e admin@example.com -p supersecret`):

```bash
# token admin
ADMIN_TOKEN=$(curl -s -X POST http://localhost:9000/auth/user/emailpass \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"supersecret"}' | jq -r .token)

# brand_id de Urban Street
URBAN_BRAND=$(curl -s http://localhost:9000/admin/brands \
  -H "authorization: Bearer $ADMIN_TOKEN" | jq -r '.brands[] | select(.slug=="urban-street") | .id')

# crear producto
curl -s -X POST http://localhost:9000/admin/brand-products \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d "{\"brand_id\":\"$URBAN_BRAND\",\"title\":\"Probe Tenancy Tee\",\"base_price\":399,\"currency_code\":\"MXN\",\"status\":\"published\",\"variants\":[{\"size\":\"M\",\"color\":{\"name\":\"Negro\",\"hex_code\":\"#000000\"},\"stock\":5}]}" | jq '.product.id, .product.title'
```
Expected: responde `201` con el `id` y `"Probe Tenancy Tee"`.

- [ ] **Step 5: Confirmar que el producto quedó en el canal de Urban Street y solo ahí**

Run: `npx medusa exec ./src/scripts/verify-brand-channels.ts`
Expected: `[verify] Todas las invariantes de tenancy se cumplen.` (el probe recorre todos los productos, incluido el nuevo).

- [ ] **Step 6: Commit**

```bash
git add src/workflows/create-product-with-brand.ts
git commit -m "feat: create-product-with-brand linkea el producto al canal de su marca"
```

---

### Task 4: Borrar `/store/products` custom y limpiar middleware

**Files:**
- Delete: `src/api/store/products/route.ts`
- Delete: `src/api/store/products/[id]/route.ts`
- Modify: `src/api/middlewares.ts`
- Modify: `src/utils/brand-middleware.ts`

**Interfaces:**
- Consumes: comportamiento nativo de Medusa para `GET /store/products` y `GET /store/products/:id` (scopea por `req.publishable_key_context.sales_channel_ids`).
- Produces: `/store/products*` deja de tener handler custom; el schema `storeProductsQuerySchema` desaparece; `validateCartBrandAccess` deja de exportarse desde `brand-middleware.ts`.

- [ ] **Step 1: Borrar los dos archivos de ruta**

Run:
```bash
git rm src/api/store/products/route.ts "src/api/store/products/[id]/route.ts"
rmdir "src/api/store/products/[id]" src/api/store/products 2>/dev/null || true
```

- [ ] **Step 2: Quitar el matcher `/store/products` y el schema en `middlewares.ts`**

En `src/api/middlewares.ts`:

1. Borrar la línea `const storeProductsQuerySchema = listProductsQuerySchema.omit({ status: true })`.
2. Borrar el bloque del array `routes`:

```ts
    // ====================
    // Store Product Routes
    // ====================
    {
      matcher: "/store/products",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(storeProductsQuerySchema, LIST_QUERY_CONFIG),
      ],
    },
```

Dejar intacto `listProductsQuerySchema` (lo usa el matcher `/admin/brand-products`).

- [ ] **Step 3: Eliminar `validateCartBrandAccess` de `brand-middleware.ts`**

En `src/utils/brand-middleware.ts`, borrar la función completa `export function validateCartBrandAccess() { ... }` con su bloque de comentario `/** Middleware to check if a customer can perform a cart/order action ... */`. Dejar `requireBrandId`, `validateCustomerBrand`, `optionalBrandId`, `extractBrandId`.

- [ ] **Step 4: Verificar que compila y arranca**

Run: `pnpm run build`
Expected: build sin errores de TypeScript relacionados a `storeProductsQuerySchema`, `validateCartBrandAccess` o los archivos borrados. (Puede haber los ~18 errores pre-existentes de `zod` en `middlewares.ts` documentados en la memoria; no deben aumentar.)

- [ ] **Step 5: Verificar scoping nativo por marca**

Run (con el server corriendo `pnpm run dev` y `PK_URBAN` / `PK_CLASSIC` del summary del seed):

```bash
PK_URBAN="pk_...urban..."
PK_CLASSIC="pk_...classic..."

# Cuenta de productos por key
curl -s "http://localhost:9000/store/products?limit=100" -H "x-publishable-api-key: $PK_URBAN"   | jq '.products | length, [.products[].title]'
curl -s "http://localhost:9000/store/products?limit=100" -H "x-publishable-api-key: $PK_CLASSIC" | jq '.products | length, [.products[].title]'
```
Expected: la lista de Urban solo trae títulos de Urban Street (Camiseta Grafitti, Playera Oversized Minimal, T-Shirt Neon Dreams, + "Probe Tenancy Tee" si se dejó); la de Classic solo trae los de Classic Threads (Polo Ejecutivo, Camiseta Básica Premium, Henley Casual). Cero cruce.

```bash
# Detalle cross-brand -> 404
CLASSIC_PROD=$(curl -s "http://localhost:9000/store/products?limit=1" -H "x-publishable-api-key: $PK_CLASSIC" | jq -r '.products[0].id')
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:9000/store/products/$CLASSIC_PROD" -H "x-publishable-api-key: $PK_URBAN"
```
Expected: `404`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix: borrar /store/products custom y usar el scoping nativo por sales channel"
```

---

### Task 5: Scopear `/store/brands/:slug/products` al canal del request

**Files:**
- Modify: `src/api/store/brands/[slug]/products/route.ts`

**Interfaces:**
- Consumes: `req.publishable_key_context.sales_channel_ids` (lo setea el middleware nativo `ensure-publishable-api-key` en toda ruta `/store/*`); link `sales_channel.brand`.
- Produces: la ruta responde `404` si el `slug` del path no es la marca del canal de la publishable key del request, o si no hay contexto de pub key.

- [ ] **Step 1: Reescribir el handler GET**

Reemplazar el contenido de `src/api/store/brands/[slug]/products/route.ts` por:

```ts
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { BRAND_MODULE } from "../../../../../modules/brand"
import type BrandModuleService from "../../../../../modules/brand/service"

// GET /store/brands/:slug/products - Productos de una marca.
// Scopeado: el slug del path DEBE ser la marca del sales channel de la
// publishable key del request. Un storefront solo consulta su propia marca.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { slug } = req.params
  const { offset = 0, limit = 20, category_id } = req.query

  // 1. Resolver la marca del canal de la publishable key.
  const channelIds =
    (req as any).publishable_key_context?.sales_channel_ids ?? []
  if (channelIds.length === 0) {
    res.status(400).json({ message: "Missing publishable API key context" })
    return
  }

  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "brand.id", "brand.slug", "brand.active"],
    filters: { id: channelIds },
  })
  const callerBrand = channels
    .map((c: any) => c.brand)
    .find((b: any) => b && b.active)

  // 2. El slug pedido debe ser el de la marca del caller.
  if (!callerBrand || callerBrand.slug !== slug) {
    res.status(404).json({ message: "Brand not found" })
    return
  }

  // 3. Productos de esa marca (comportamiento previo).
  const brand = await brandService.findBySlug(slug)
  if (!brand || !brand.active) {
    res.status(404).json({ message: "Brand not found" })
    return
  }

  const filters: Record<string, unknown> = { brand: { id: brand.id } }
  if (category_id) {
    filters.category_id = category_id
  }

  const { data: products, metadata } = await query.graph({
    entity: "product",
    fields: [
      "*",
      "variants.*",
      "variants.prices.*",
      "images.*",
      "categories.*",
      "brand.*",
    ],
    filters,
    pagination: { skip: Number(offset), take: Number(limit) },
  })

  res.json({
    products,
    count: metadata?.count || products.length,
    offset: Number(offset),
    limit: Number(limit),
    brand,
  })
}
```

- [ ] **Step 2: Verificar acceso propio y cross-brand**

Run (server corriendo):

```bash
# Propia marca -> 200
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:9000/store/brands/urban-street/products" -H "x-publishable-api-key: $PK_URBAN"
# Marca ajena -> 404
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:9000/store/brands/classic-threads/products" -H "x-publishable-api-key: $PK_URBAN"
# Sin key -> 400 (lo corta el middleware nativo antes, en la práctica; si llega, 400)
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:9000/store/brands/urban-street/products"
```
Expected: `200`, luego `404`, luego `400` (o `401`/`403` si el middleware nativo de pub key lo corta antes — cualquiera de esos es aceptable para el tercer caso).

- [ ] **Step 3: Commit**

```bash
git add "src/api/store/brands/[slug]/products/route.ts"
git commit -m "fix: scopear /store/brands/:slug/products al canal de la publishable key"
```

---

### Task 6: Docs + checklist de verificación end-to-end

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `PENDIENTES.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: docs alineadas; `PENDIENTES.md` con el pendiente del carrito marcado resuelto, `/store/products?brand_id=` marcado obsoleto, follow-ups nuevos, y un checklist de verificación con resultados reales pegados.

- [ ] **Step 1: Actualizar la sección de storefronts del `README.md`**

Reemplazar la sección "## Configuración de Storefronts" por:

```markdown
## Configuración de Storefronts

Cada marca tiene su **propio sales channel y su propia publishable key** (las
imprime `pnpm run seed` al final). Cada storefront Next.js se configura con la
key de su marca:

```env
NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_...   # la de "Urban Street Storefront" o "Classic Threads Storefront"
NEXT_PUBLIC_BRAND_SLUG=urban-street          # o classic-threads
```

Con eso, `/store/products`, `/store/carts` y el checkout quedan aislados por
marca de forma nativa (Medusa filtra por el sales channel de la key). El header
`X-Brand-Id` se sigue enviando en las llamadas autenticadas de cliente
(`/store/customers/me*`, `/store/orders*`), que se validan contra la marca
asociada al cliente.
```

- [ ] **Step 2: Nota en `.env.example`**

Bajo la sección CORS (después de la línea `AUTH_CORS=...`), añadir:

```bash
# ===========================================
# Publishable keys por marca
# ===========================================
# NO se ponen aquí: las genera e imprime `pnpm run seed` (una por marca:
# "Urban Street Storefront" y "Classic Threads Storefront"). Cada storefront
# usa la de su marca como NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY.
```

- [ ] **Step 3: `PENDIENTES.md` — mover resueltos y obsoletos**

En la tabla `## ✅ Resuelto`, añadir una fila al final:

```markdown
| **Brand como tenant (sales channel por marca)** | — | Cada marca tiene su sales channel (`Urban Street` / `Classic Threads`) y su publishable key (`<Marca> Storefront`), creados por `seed.ts`. Link nuevo `brand ↔ sales_channel` (`src/links/brand-sales-channel.ts`). `create-product-with-brand` linkea cada producto al canal de su marca. Con eso `/store/products`, `/store/carts` y el checkout quedan aislados por marca de forma nativa (Medusa filtra por el canal de la pub key; un carrito rechaza line items fuera de su canal). Se borraron `/store/products` y `/store/products/[id]` custom (el nativo ya scopea). `/store/brands/:slug/products` ahora exige que el slug sea la marca del canal del request. La capa `customer_brand` + `X-Brand-Id` para clientes/pedidos no cambia. |
```

En `## 🔴 Pendientes`, **eliminar** el bullet completo de:

```markdown
- `src/utils/brand-middleware.ts` exporta `requireBrandId`,
  `validateCartBrandAccess`, `optionalBrandId` sin cablear — toolkit pensado
  para `/store/carts` (evitar compras cross-brand). Cablearlos cuando se
  trabaje el carrito.
```

y reemplazarlo por:

```markdown
- `src/utils/brand-middleware.ts` exporta `requireBrandId` y `optionalBrandId`
  sin cablear — utilidades genéricas de extracción de marca, disponibles si se
  necesitan. (`validateCartBrandAccess` se eliminó: el aislamiento de carrito
  ahora es nativo vía sales channel.)
```

En la sección 2 (follow-ups del admin dashboard), **eliminar** el bullet de
`GET /store/products?brand_id=` (empieza con "`GET /store/products?brand_id=` sigue
devolviendo 400") — la ruta custom ya no existe.

- [ ] **Step 4: `PENDIENTES.md` — follow-ups nuevos**

Al final de `## 🔴 Pendientes`, sección "### 1. Varios", añadir:

```markdown
- `/store/categories*` filtradas por `brand_id` no están scopeadas al canal de
  la publishable key (a diferencia de `/store/products` y `/store/brands/:slug/products`).
  Bajo riesgo (hay categorías globales), pero conviene scoparlas.
- `X-Brand-Id` en `/store/customers/me*` y `/store/orders*` podría derivarse del
  sales channel de la publishable key en vez de exigir el header explícito.
- No hay admin user scopeado por marca: el admin ve todos los canales/marcas.
- Almacén único (`Almacén CDMX`) compartido entre los sales channels de las dos
  marcas; si se quiere inventario separado, un stock location por marca.
- Filtros de catálogo que tenía el `/store/products` custom borrado
  (`min_price`/`max_price`/`sizes`/`in_stock`): reimplementar como ruta custom
  scopeada por canal si un storefront los necesita.
- `default_sales_channel_id` del store apunta al "Default Sales Channel" de
  Medusa (sin publishable key, ningún storefront lo usa). El canal legacy que
  pudiera existir queda vacío (productos desvinculados por el seed) — huérfano
  inofensivo.
```

- [ ] **Step 5: Correr el checklist de verificación completo y pegar resultados**

Con `docker-compose up -d`, seed aplicado, `pnpm run dev` corriendo, admin user creado, y `PK_URBAN`/`PK_CLASSIC` a mano. Ejecutar cada comando y anotar el resultado real:

```bash
# 1. Catálogo aislado
curl -s "http://localhost:9000/store/products?limit=100" -H "x-publishable-api-key: $PK_URBAN"   | jq '[.products[].title]'
curl -s "http://localhost:9000/store/products?limit=100" -H "x-publishable-api-key: $PK_CLASSIC" | jq '[.products[].title]'

# 2. Detalle cross-brand -> 404
CLASSIC_PROD=$(curl -s "http://localhost:9000/store/products?limit=1" -H "x-publishable-api-key: $PK_CLASSIC" | jq -r '.products[0].id')
curl -s -o /dev/null -w 'detalle cross-brand: %{http_code}\n' "http://localhost:9000/store/products/$CLASSIC_PROD" -H "x-publishable-api-key: $PK_URBAN"

# 3. Carrito no mezcla marcas
REGION=$(curl -s "http://localhost:9000/store/regions" -H "x-publishable-api-key: $PK_URBAN" | jq -r '.regions[0].id')
URBAN_VAR=$(curl -s "http://localhost:9000/store/products?limit=1&fields=*variants" -H "x-publishable-api-key: $PK_URBAN" | jq -r '.products[0].variants[0].id')
CLASSIC_VAR=$(curl -s "http://localhost:9000/store/products?limit=1&fields=*variants" -H "x-publishable-api-key: $PK_CLASSIC" | jq -r '.products[0].variants[0].id')
CART=$(curl -s -X POST "http://localhost:9000/store/carts" -H "x-publishable-api-key: $PK_URBAN" -H 'content-type: application/json' -d "{\"region_id\":\"$REGION\"}" | jq -r '.cart.id')
curl -s -X POST "http://localhost:9000/store/carts/$CART/line-items" -H "x-publishable-api-key: $PK_URBAN" -H 'content-type: application/json' -d "{\"variant_id\":\"$URBAN_VAR\",\"quantity\":1}" | jq -r '.cart.items | length'   # -> 1
curl -s -o /dev/null -w 'add cross-brand al carrito: %{http_code}\n' -X POST "http://localhost:9000/store/carts/$CART/line-items" -H "x-publishable-api-key: $PK_URBAN" -H 'content-type: application/json' -d "{\"variant_id\":\"$CLASSIC_VAR\",\"quantity\":1}"   # -> 400

# 4. /store/brands/:slug/products scopeado
curl -s -o /dev/null -w 'brands propia: %{http_code}\n'  "http://localhost:9000/store/brands/urban-street/products"   -H "x-publishable-api-key: $PK_URBAN"
curl -s -o /dev/null -w 'brands ajena: %{http_code}\n'   "http://localhost:9000/store/brands/classic-threads/products" -H "x-publishable-api-key: $PK_URBAN"

# 5. Checkout regresión (provider manual) con key de marca
#    Reusar el smoke test de PENDIENTES.md "Smoke test del checkout" pero con -H "x-publishable-api-key: $PK_URBAN".
#    Expected: POST .../complete -> { "type": "order", ... }

# 6. Probe de invariantes de datos
npx medusa exec ./src/scripts/verify-brand-channels.ts
```

Pegar los resultados en `PENDIENTES.md` bajo un nuevo subtítulo `### Verificación de la migración a sales-channel-por-marca (2026-09-07)` con el mismo estilo de las verificaciones de checkout existentes (qué se probó, qué salió).

- [ ] **Step 6: Commit**

```bash
git add README.md .env.example PENDIENTES.md
git commit -m "docs: registrar migración a sales-channel-por-marca y su verificación"
```

---

### Task 7: Guard de marca en el carrito (añadida tras la verificación de Task 6)

**Por qué:** La verificación de Task 6 (caso 3) demostró que la premisa del spec
—"un carrito rechaza nativamente line items fuera de su sales channel"— es
**falsa** en Medusa 2.20.1: agregar una variante de otra marca a un carrito
devuelve `200` y el carrito mixto completa a orden. El aislamiento de catálogo
(Tasks 4-5) evita que un storefront *descubra* IDs ajenos, pero un cliente con un
`variant_id` ajeno puede mezclar marcas y comprar. Esta task reintroduce la
validación explícita que `validateCartBrandAccess` (borrada en Task 4) pretendía
dar, ahora apoyada en el `sales_channel_id` que el carrito ya lleva.

**Files:**
- Modify: `src/utils/brand-middleware.ts` — añadir `validateCartLineItemBrand()`.
- Modify: `src/api/middlewares.ts` — cablearla en `POST /store/carts/:id/line-items` y `POST /store/carts/:id/complete`.
- Modify: `PENDIENTES.md` — corregir la fila "Resuelto" y la sección de verificación (caso 3 pasa a ✅), quitar/ajustar el follow-up del cart leak.
- Modify: `README.md` — la sección de storefronts afirma "`/store/carts` y el checkout quedan aislados por marca de forma nativa"; cambiar "de forma nativa" por "mediante un middleware de validación de marca (`validateCartLineItemBrand`)".

**Interfaces:**
- Consumes: el link `brand ↔ sales_channel` (Task 1); el `sales_channel_id` que Medusa setea en el carrito desde el contexto de la publishable key.
- Produces: `validateCartLineItemBrand(): MedusaRequestHandler` — middleware que responde `403 { type: "not_allowed", message }` si la variante entrante (body `variant_id`) o algún line item ya presente pertenece a un producto que no está en el `sales_channel_id` del carrito. Si el carrito no existe o no tiene `sales_channel_id`, llama `next()` (deja que el handler nativo responda).

- [ ] **Step 1: Reproducir el fallo (RED)**

Con el server corriendo y `PK_URBAN` / `PK_CLASSIC` del seed:

```bash
REGION=$(curl -s localhost:9000/store/regions -H "x-publishable-api-key: $PK_URBAN" | jq -r '.regions[0].id')
UVAR=$(curl -s "localhost:9000/store/products?limit=1&fields=id,*variants" -H "x-publishable-api-key: $PK_URBAN" | jq -r '.products[0].variants[0].id')
CVAR=$(curl -s "localhost:9000/store/products?limit=1&fields=id,*variants" -H "x-publishable-api-key: $PK_CLASSIC" | jq -r '.products[0].variants[0].id')
CART=$(curl -s -X POST localhost:9000/store/carts -H "x-publishable-api-key: $PK_URBAN" -H 'content-type: application/json' -d "{\"region_id\":\"$REGION\"}" | jq -r '.cart.id')
curl -s -X POST "localhost:9000/store/carts/$CART/line-items" -H "x-publishable-api-key: $PK_URBAN" -H 'content-type: application/json' -d "{\"variant_id\":\"$UVAR\",\"quantity\":1}" >/dev/null
curl -s -o /dev/null -w 'add cross-brand ANTES del guard: %{http_code}\n' -X POST "localhost:9000/store/carts/$CART/line-items" -H "x-publishable-api-key: $PK_URBAN" -H 'content-type: application/json' -d "{\"variant_id\":\"$CVAR\",\"quantity\":1}"
```
Expected: `add cross-brand ANTES del guard: 200` (el bug).

- [ ] **Step 2: Añadir `validateCartLineItemBrand()` a `src/utils/brand-middleware.ts`**

Añadir al final del archivo (después de `optionalBrandId`), reutilizando los imports ya presentes (`MedusaRequest/Response/NextFunction`, `ContainerRegistrationKeys` — añadir este import si falta: `import { ContainerRegistrationKeys } from "@medusajs/framework/utils"`):

```ts
/**
 * Middleware: impide que un carrito contenga productos de más de una marca.
 *
 * Medusa 2.20.1 NO valida la pertenencia de una variante al sales channel del
 * carrito (ni al agregar line items ni al completar). Este guard lo hace de
 * forma explícita: resuelve el `sales_channel_id` del carrito y rechaza (403)
 * si la variante entrante (`body.variant_id`) o cualquier line item ya
 * presente pertenece a un producto que no está en ese canal. Como cada canal
 * es 1:1 con una marca (link `brand ↔ sales_channel`), "otro canal" = "otra
 * marca".
 *
 * Cablear en POST /store/carts/:id/line-items y POST /store/carts/:id/complete.
 */
export function validateCartLineItemBrand() {
  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    const cartId = req.params.id
    if (!cartId) {
      return next()
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    try {
      const { data: carts } = await query.graph({
        entity: "cart",
        fields: ["id", "sales_channel_id", "items.variant_id"],
        filters: { id: cartId },
      })
      const cart = carts[0]
      const cartChannelId = cart?.sales_channel_id

      // Sin carrito o sin canal: nada que validar, que siga el handler nativo.
      if (!cart || !cartChannelId) {
        return next()
      }

      const variantIds = new Set<string>()
      const incoming = (req.body as any)?.variant_id
      if (typeof incoming === "string" && incoming) {
        variantIds.add(incoming)
      }
      for (const item of cart.items ?? []) {
        if (item?.variant_id) {
          variantIds.add(item.variant_id)
        }
      }

      if (variantIds.size === 0) {
        return next()
      }

      const { data: variants } = await query.graph({
        entity: "variant",
        fields: ["id", "product.sales_channels.id"],
        filters: { id: Array.from(variantIds) },
      })

      for (const variant of variants as any[]) {
        const channelIds: string[] = (variant.product?.sales_channels ?? []).map(
          (sc: any) => sc.id
        )
        if (!channelIds.includes(cartChannelId)) {
          return res.status(403).json({
            type: "not_allowed",
            message:
              "No puedes agregar productos de otra marca a este carrito.",
          })
        }
      }

      return next()
    } catch (error) {
      return res.status(500).json({
        type: "server_error",
        message: "Error al validar la marca del carrito.",
      })
    }
  }
}
```

- [ ] **Step 3: Cablear en `src/api/middlewares.ts`**

Añadir el import junto al de `validateCustomerBrand`:

```ts
import { validateCustomerBrand, validateCartLineItemBrand } from "../utils/brand-middleware"
```

Y en el array `routes` de `defineMiddlewares`, añadir (después del bloque de Store Customer Routes):

```ts
    // ==================
    // Store Cart Routes (brand guard — Medusa 2.20 no valida el sales channel
    // de la variante en el carrito)
    // ==================
    {
      matcher: "/store/carts/:id/line-items",
      method: "POST",
      middlewares: [validateCartLineItemBrand()],
    },
    {
      matcher: "/store/carts/:id/complete",
      method: "POST",
      middlewares: [validateCartLineItemBrand()],
    },
```

- [ ] **Step 4: Build**

Run: `pnpm run build`
Expected: tsc sin errores nuevos (sigue en 0). Reiniciar el server con el build nuevo.

- [ ] **Step 5: Verificar el guard (GREEN)**

```bash
# mismo setup del Step 1: REGION, UVAR, CVAR, CART con un item Urban ya dentro
# a) cross-brand en line-items -> 403
curl -s -o /dev/null -w 'add cross-brand con guard: %{http_code}\n' -X POST "localhost:9000/store/carts/$CART/line-items" -H "x-publishable-api-key: $PK_URBAN" -H 'content-type: application/json' -d "{\"variant_id\":\"$CVAR\",\"quantity\":1}"
# b) misma marca sigue funcionando -> 200
UVAR2=$(curl -s "localhost:9000/store/products?limit=2&fields=id,*variants" -H "x-publishable-api-key: $PK_URBAN" | jq -r '.products[1].variants[0].id')
curl -s -o /dev/null -w 'add misma marca: %{http_code}\n' -X POST "localhost:9000/store/carts/$CART/line-items" -H "x-publishable-api-key: $PK_URBAN" -H 'content-type: application/json' -d "{\"variant_id\":\"$UVAR2\",\"quantity\":1}"
# c) checkout Urban completo (repetir el smoke de PENDIENTES con PK_URBAN) -> { "type": "order" }
```
Expected: `add cross-brand con guard: 403`; `add misma marca: 200`; checkout de una sola marca completa a orden.

- [ ] **Step 6: Verificar el guard en /complete con un carrito mixto pre-existente**

```bash
# Crear un carrito mixto SALTÁNDOSE el guard: agregar el item Classic vía un
# segundo carrito no sirve; en su lugar, comprobar que un carrito que YA tiene
# 2 marcas (por datos legacy) no puede completar. Simular: crear carrito Urban,
# agregar item Urban, y con `npx medusa exec` insertar un line item Classic
# directo por el módulo de carrito, luego:
curl -s -o /dev/null -w 'complete carrito mixto: %{http_code}\n' -X POST "localhost:9000/store/carts/$MIXED_CART/complete" -H "x-publishable-api-key: $PK_URBAN"
```
Expected: `complete carrito mixto: 403`. (Si montar el carrito mixto por módulo es demasiado, basta con documentar que el mismo middleware corre en `/complete` y el check recorre `cart.items` — el Step 5a ya prueba la ruta de código.)

- [ ] **Step 7: Actualizar `PENDIENTES.md` y `README.md`**

- Sección `### Verificación de la migración a sales-channel-por-marca`: cambiar el **Caso 3** de ❌ FALLA a ✅, describiendo que el guard `validateCartLineItemBrand` (cableado en `/store/carts/:id/line-items` y `/complete`) devuelve `403` al mezclar marcas, y que el checkout de una sola marca sigue pasando.
- Fila "Resuelto" **Brand como tenant**: cambiar "un carrito rechaza line items fuera de su canal" por "un middleware (`validateCartLineItemBrand`) rechaza (`403`) agregar o completar un carrito con productos de más de una marca — Medusa 2.20 no lo valida nativamente".
- Follow-up del cart leak en `### 1. Varios`: reemplazar el bullet "**El carrito NO valida el sales channel de la variante**..." por una nota corta de que quedó cubierto por `validateCartLineItemBrand`, dejando como follow-up solo el caso de `cart.metadata.brand_id` / carritos sin `sales_channel_id`.
- `README.md` sección storefronts: "`/store/products` … aislados por marca de forma nativa … `/store/carts` y el checkout" → separar: `/store/products` y `/store/brands/:slug/products` de forma nativa por el sales channel; `/store/carts` y el checkout mediante el middleware `validateCartLineItemBrand`.

- [ ] **Step 8: Commit**

```bash
git add src/utils/brand-middleware.ts src/api/middlewares.ts PENDIENTES.md README.md
git commit -m "fix: validar marca del carrito en line-items y complete (Medusa 2.20 no lo hace)"
```

---

## Self-Review

**1. Spec coverage:**

| Sección del spec | Task |
|---|---|
| Link `brand ↔ sales_channel` | Task 1 |
| Seed: canal + key por marca, links a stock location y key, `default_sales_channel_id`, summary | Task 2 (steps 3-8) |
| Seed: migración idempotente de DBs viejas (desvincular productos de canal legacy) | Task 2 (step 7) — refinado: unlink en vez de delete, documentado en nota |
| Workflow `linkProductToBrandSalesChannelStep` | Task 3 |
| Borrar `/store/products` + `/store/products/[id]` + matcher + schema | Task 4 (steps 1-2) |
| Eliminar `validateCartBrandAccess` | Task 4 (step 3) |
| Scopear `/store/brands/:slug/products` con `publishable_key_context.sales_channel_ids` | Task 5 |
| Carrito/checkout sin cambios de código, verificado | Task 6 (step 5, caso 3 y 5) |
| Capa `customer_brand` sin cambios | (ninguna task la toca — correcto) |
| README storefronts | Task 6 (step 1) |
| `.env.example` | Task 6 (step 2) |
| PENDIENTES: resueltos/obsoletos + follow-ups + checklist con resultados | Task 6 (steps 3-5) |
| Checklist de verificación curl (6 casos del spec) | Task 6 (step 5) |

Sin gaps. Follow-ups del spec (categorías, `X-Brand-Id` derivado, admin por marca, stock por marca, migración productiva dedicada) quedan anotados en `PENDIENTES.md` en Task 6 step 4, no implementados — correcto.

**2. Placeholder scan:** Sin "TBD"/"TODO"/"handle edge cases". Todos los steps de código llevan el código completo. Los comandos de verificación llevan `Expected:` explícito.

**3. Type consistency:**
- `brandChannels: Record<string, { channelId: string; keyToken: string }>` — definido en Task 2 step 6, consumido en Task 2 step 7 y step 8 con esas mismas propiedades (`.channelId`, `.keyToken`). ✓
- `BRAND_CHANNELS: Record<string, string>` (slug → nombre de canal) — mismo shape en `seed.ts` (Task 2) y en `verify-brand-channels.ts` (Task 2 step 1). ✓
- `linkProductToBrandSalesChannelStep` recibe `{ product_id, brand_id }` y devuelve `StepResponse({ product_id, channel_id })`; la compensación usa `data.channel_id` y `data.product_id`. ✓
- `linkProductsToSalesChannelWorkflow` input `{ id, add, remove }` — usado consistente en Task 2 y Task 3, coincide con `LinkProductsToSalesChannelWorkflowInput` de core-flows. ✓
- `req.publishable_key_context.sales_channel_ids` — nombre confirmado contra `@medusajs/framework/dist/http/middlewares/ensure-publishable-api-key.js`; usado en Task 5. ✓
- `SalesChannelModule.linkable.salesChannel` — confirmado por probe; usado en Task 1. ✓
- `Modules.SALES_CHANNEL` en `link.create` (Task 2 step 6) — es la constante correcta para el `remoteLink`; el `brand` usa `BRAND_MODULE` como en `create-product-with-brand.ts`. ✓

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-07-brand-sales-channel-tenancy.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
