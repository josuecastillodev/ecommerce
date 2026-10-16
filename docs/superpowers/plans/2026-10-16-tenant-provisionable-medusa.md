# Medusa provisionable por tenant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el mismo código de Medusa deje lista para vender una instancia de tenant a partir de una config que empuja el control plane, y mantenga sincronizadas sus marcas en cada cambio.

**Architecture:** Un workflow `applyTenantConfigWorkflow` con dos pasos: valores iniciales (una sola vez por tenant, marcados con `store.metadata.tenant_bootstrapped_at`) y sincronización de marcas (crea/actualiza/desactiva/reactiva marca + sales channel + publishable key). Dos entradas al mismo workflow, ambas a través de `runTenantApply()` (que toma un lock de Redis): el endpoint `POST /internal/tenant/apply` con bearer token y el CLI `tenant:apply`. La demo (Urban Street + Classic Threads) pasa a ser `tenants/demo.json` + `seed-demo.ts`. Las marcas quedan de solo lectura en el admin de Medusa, salvo su apariencia.

**Tech Stack:** Medusa.js 2.20.1, TypeScript, `@medusajs/framework` workflows-sdk, `@medusajs/medusa/core-flows`, `@medusajs/medusa/locking-redis`, zod 4.2.0 (import `"zod"`), Postgres, Redis, pnpm 10.28.2.

**Spec:** `docs/superpowers/specs/2026-10-16-tenant-provisionable-medusa-design.md`

## Global Constraints

- Dependencias: solo `pnpm`. **No agregar dependencias nuevas** (todo lo necesario ya está instalado: `@medusajs/medusa` trae locking-redis; `zod@4.2.0`; `ts-node`).
- Node `24.1.0` (`.nvmrc`), pnpm `10.28.2` (`packageManager`). Si `pnpm` falla por versión de Node, usa el Node de `.nvmrc`.
- Montos en **decimal** (unidad mayor): `amount: 99` = $99 MXN. Nunca centavos.
- `slug` de marca: kebab-case `^[a-z0-9]+(-[a-z0-9]+)*$`, único en la config, inmutable.
- `version` de la config debe ser exactamente `1`.
- Publishable key de una marca: título exacto `"<name de la marca> Storefront"`. Sales channel de una marca: nombre exacto = `name` de la marca.
- Marcador de bootstrap: clave `tenant_bootstrapped_at` en `store.metadata` (valor ISO string).
- Lock: clave `tenant-apply`, proveedor Redis, sin espera (si está tomado → error inmediato).
- Endpoint: `POST /internal/tenant/apply`; header `Authorization: Bearer <CONTROL_PLANE_TOKEN>`; sin `CONTROL_PLANE_TOKEN` en env → 404; token mal → 401; body inválido → 400; lock tomado → 409; OK → 200.
- Apariencia de marca editable en Medusa: **solo** `logo_url`, `primary_color`, `secondary_color`, `description`. `apply` solo los usa al **crear** la marca.
- Una marca nunca se borra: se desactiva (`active=false`, canal `is_disabled=true`, keys revocadas). Reactivar crea una key **nueva**.
- Mensajes de commit cortos `tipo: mensaje` en español (feat/fix/docs/chore/refactor), **sin créditos de autoría ni líneas Co-Authored-By**.
- No hay jest. La verificación es con scripts `npx medusa exec`, `curl`, `npx tsc --noEmit -p .` y `pnpm run build`.

### Entorno de verificación (léelo antes de la Task 1)

En la máquina de desarrollo hay **otro stack Docker** ocupando 5432/6379/9000. Este repo se levanta en puertos alternos:

```bash
POSTGRES_PORT=55432 REDIS_PORT=56379 docker compose up -d postgres redis
export DEV_DB_URL="$(grep ^DATABASE_URL .env | cut -d= -f2- | sed 's/:5432/:55432/')"
export REDIS_URL=redis://localhost:56379
export DATABASE_URL="$DEV_DB_URL"
```

**DB desechable** (para escenarios destructivos; nunca uses la de desarrollo para eso):

```bash
docker exec medusa-postgres psql -U medusa -d postgres \
  -c "drop database if exists medusa_tenant_scratch with (force)" \
  -c "create database medusa_tenant_scratch"
export SCRATCH_DB_URL="${DEV_DB_URL%/*}/medusa_tenant_scratch"
DATABASE_URL="$SCRATCH_DB_URL" npx medusa db:migrate
```

Servidor para pruebas con curl, en el puerto 9100:

```bash
(npx medusa develop --port 9100 > /tmp/medusa-dev.log 2>&1 &)
until curl -sf localhost:9100/health >/dev/null; do sleep 2; done
```

Para detenerlo, **mata también el proceso hijo** (`pkill` solo no basta):

```bash
pkill -f "medusa develop"; lsof -tiTCP:9100 -sTCP:LISTEN | xargs -r kill
```

Usuario admin de desarrollo: `admin@example.com` / `supersecret`.

## Review Focus

1. **Adopción de la DB existente:** el primer `apply`/`seed` sobre la DB de desarrollo actual (sin marcador, con región, almacén, envíos, canales y keys ya creados por el seed viejo) no debe duplicar nada. → Test en Task 6, Step 4.
2. **Marca renombrada:** cambiar `name` en la config renombra canal y key, no crea otros. → Test en Task 3 (escenario 3).
3. **Reactivación conserva apariencia:** una marca quitada y vuelta a poner mantiene los colores editados por el cliente y recibe una key nueva distinta de la revocada. → Test en Task 3 (escenario 4).
4. **Dos `apply` simultáneos:** uno responde 409 y el otro termina bien, y el lock se libera aunque el workflow falle. → Test en Task 4, Step 6.
5. **Edición de marca con campos estructurales desde el admin:** `name`/`slug`/`active` en `POST /admin/brands/:id` → 400, sin cambiar nada. → Test en Task 5, Step 5.

---

## File Structure

**Nuevos:**
- `src/tenant/config-schema.ts` — `TenantConfigSchema` (zod), tipos `TenantConfig`, `TenantBrandConfig`.
- `src/tenant/safe-link.ts` — `safeLink()` (ignora "ya existe" para crear links idempotentes).
- `src/tenant/initial-defaults.ts` — `applyInitialDefaults()` (paso 1) y `BOOTSTRAP_MARKER`.
- `src/tenant/sync-brands.ts` — `syncBrands()` y `undoCreatedBrands()` (paso 2).
- `src/tenant/run-apply.ts` — `runTenantApply()` (lock + workflow) y `TenantApplyLockedError`.
- `src/tenant/invariants.ts` — `checkTenancyInvariants()` (usado por el probe y por los escenarios).
- `src/workflows/apply-tenant-config.ts` — `applyTenantConfigWorkflow`.
- `src/api/internal/tenant/apply/route.ts` — endpoint.
- `src/utils/control-plane-auth.ts` — middleware `requireControlPlaneToken()`.
- `src/scripts/tenant-apply.ts` — CLI.
- `src/scripts/verify-tenant-apply.ts` — escenarios sobre DB desechable.
- `tenants/demo.json` — config de la demo.

**Modificados:**
- `medusa-config.ts` — módulo de locking con proveedor Redis.
- `package.json` — scripts `seed` (→ `seed-demo.ts`) y `tenant:apply`.
- `src/scripts/verify-brand-channels.ts` — reescrito sobre `checkTenancyInvariants()`.
- `src/api/middlewares.ts` — ruta `/internal/tenant/apply`; schema de edición de marca restringido; quitar el de creación.
- `src/api/admin/brands/route.ts`, `src/api/admin/brands/[id]/route.ts` — crear/borrar → 403; editar solo apariencia.
- `src/admin/lib/api.ts`, `src/admin/routes/brands/page.tsx`, `src/admin/routes/brands/[id]/page.tsx` — UI de solo lectura salvo apariencia.
- `README.md`, `PENDIENTES.md`, el spec (dos aclaraciones).

**Movidos / borrados:**
- `src/scripts/seed.ts` → `src/scripts/seed-demo.ts` (se recorta).
- Borrar `src/admin/routes/brands/create/page.tsx`.

---

### Task 1: Config del tenant, demo y lock de Redis

**Files:**
- Create: `src/tenant/config-schema.ts`
- Create: `tenants/demo.json`
- Modify: `medusa-config.ts` (agregar módulo de locking al final de `modules`)
- Modify: `docs/superpowers/specs/2026-10-16-tenant-provisionable-medusa-design.md` (dos aclaraciones)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `TenantConfigSchema` (zod) y `type TenantConfig = z.infer<typeof TenantConfigSchema>`.
  - `type TenantBrandConfig = TenantConfig["brands"][number]` con `{ slug, name, active, description, logo_url, primary_color, secondary_color }` (los tres últimos con defaults).
  - `tenants/demo.json` válido contra el schema.
  - Módulo `Modules.LOCKING` con proveedor Redis por defecto.

- [ ] **Step 1: Escribir el chequeo que debe fallar**

Run:
```bash
npx ts-node -T -e '
const { TenantConfigSchema } = require("./src/tenant/config-schema")
const demo = require("./tenants/demo.json")
const ok = TenantConfigSchema.safeParse(demo)
if (!ok.success) { console.error(ok.error.issues); process.exit(1) }
const bad = [
  { ...demo, version: 2 },
  { ...demo, brands: [{ ...demo.brands[0], slug: "Con Espacio" }] },
  { ...demo, brands: [demo.brands[0], demo.brands[0]] },
  { ...demo, initial: { ...demo.initial, shipping_options: [{ ...demo.initial.shipping_options[0], amount: -1 }] } },
  { ...demo, brands: [{ ...demo.brands[0], primary_color: "rojo" }] },
]
for (const b of bad) if (TenantConfigSchema.safeParse(b).success) { console.error("debió fallar", JSON.stringify(b).slice(0, 120)); process.exit(1) }
const parsed = ok.data
if (parsed.brands[0].primary_color !== demo.brands[0].primary_color) process.exit(1)
console.log("schema OK")
'
```
Expected: FAIL con `Cannot find module './src/tenant/config-schema'`.

- [ ] **Step 2: Crear `src/tenant/config-schema.ts`**

```ts
/**
 * Config de un tenant que empuja el control plane (spec 2026-10-16).
 * `brands` la manda el control plane en cada apply; `initial` solo se usa en
 * el primer apply (ver initial-defaults.ts).
 */
import { z } from "zod"

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Debe ser un color hex #RRGGBB")

const brandSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug en kebab-case"),
  name: z.string().min(1),
  active: z.boolean().default(true),
  // Apariencia: solo se usa al crear la marca; después la edita el cliente.
  description: z.string().nullable().default(null),
  logo_url: z.string().url().nullable().default(null),
  primary_color: hexColor.default("#000000"),
  secondary_color: hexColor.default("#FFFFFF"),
})

const shippingOptionSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(""),
  amount: z.number().nonnegative(),
})

export const TenantConfigSchema = z.object({
  version: z.literal(1),
  store: z.object({ name: z.string().min(1) }),
  brands: z
    .array(brandSchema)
    .refine(
      (brands) => new Set(brands.map((b) => b.slug)).size === brands.length,
      "Los slugs de marca deben ser únicos"
    ),
  initial: z.object({
    currency: z.string().length(3).toLowerCase(),
    region: z.object({
      name: z.string().min(1),
      countries: z.array(z.string().length(2).toLowerCase()).min(1),
      payment_providers: z.array(z.string().min(1)).min(1),
    }),
    stock_location: z.object({
      name: z.string().min(1),
      address: z.object({
        address_1: z.string().min(1),
        city: z.string().min(1),
        country_code: z.string().length(2).toLowerCase(),
        postal_code: z.string().min(1),
      }),
    }),
    shipping_options: z.array(shippingOptionSchema).min(1),
  }),
})

export type TenantConfig = z.infer<typeof TenantConfigSchema>
export type TenantBrandConfig = TenantConfig["brands"][number]
```

- [ ] **Step 3: Crear `tenants/demo.json`**

Valores copiados del `seed.ts` actual (marcas, región, almacén, envíos):

```json
{
  "version": 1,
  "store": { "name": "Tienda Multi-Marca" },
  "brands": [
    {
      "slug": "urban-street",
      "name": "Urban Street",
      "active": true,
      "description": "Streetwear urbano para jóvenes audaces",
      "logo_url": null,
      "primary_color": "#1A1A1A",
      "secondary_color": "#FF4444"
    },
    {
      "slug": "classic-threads",
      "name": "Classic Threads",
      "active": true,
      "description": "Moda clásica y atemporal para toda ocasión",
      "logo_url": null,
      "primary_color": "#2C3E50",
      "secondary_color": "#ECF0F1"
    }
  ],
  "initial": {
    "currency": "mxn",
    "region": {
      "name": "México",
      "countries": ["mx"],
      "payment_providers": ["pp_system_default", "pp_stripe_stripe", "pp_stripe-oxxo_stripe"]
    },
    "stock_location": {
      "name": "Almacén CDMX",
      "address": {
        "address_1": "Av. Paseo de la Reforma 1",
        "city": "Ciudad de México",
        "country_code": "mx",
        "postal_code": "06600"
      }
    },
    "shipping_options": [
      { "name": "Envío Estándar", "code": "standard", "label": "Estándar", "description": "Entrega en 3-5 días hábiles", "amount": 99 },
      { "name": "Envío Exprés", "code": "express", "label": "Exprés", "description": "Entrega en 1-2 días hábiles", "amount": 199 }
    ]
  }
}
```

- [ ] **Step 4: Correr el chequeo**

Run: el comando del Step 1.
Expected: `schema OK`.

- [ ] **Step 5: Configurar el locking con Redis**

En `medusa-config.ts`, dentro del arreglo `modules`, después del bloque `// Workflow engine module - Redis`, agregar:

```ts
    // Locking module - Redis (tenant apply: excluye server y CLI a la vez)
    {
      resolve: "@medusajs/medusa/locking",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/locking-redis",
            id: "locking-redis",
            is_default: true,
            options: {
              redisUrl: process.env.REDIS_URL,
            },
          },
        ],
      },
    },
```

Run: `npx medusa exec ./src/scripts/verify-brand-channels.ts 2>&1 | grep -E "locking|rror" | head`
Expected: sin errores de carga del módulo de locking (el probe puede reportar sus propios FAIL; aquí solo importa que Medusa arranque).

- [ ] **Step 6: Dos aclaraciones en el spec**

En `docs/superpowers/specs/2026-10-16-tenant-provisionable-medusa-design.md`:

1. En la tabla del paso 2, fila "En la config, no en la DB", cambiar `y liga el canal al almacén` por `y liga el canal a **todas** las stock locations del tenant (normalmente una; si el cliente agrega almacenes después, los canales nuevos también los ven)`.
2. En "Garantías", reemplazar la línea de **Rollback** por:
   `- **Rollback:** si el paso 2 falla, su compensación borra lo que ese apply **creó** (keys, canales, marcas nuevas). Las actualizaciones y el paso 1 no se revierten: son convergentes (buscar por clave natural antes de crear), así que reintentar el apply termina en el mismo estado.`

- [ ] **Step 7: Commit**

```bash
git add src/tenant/config-schema.ts tenants/demo.json medusa-config.ts docs/superpowers/specs/2026-10-16-tenant-provisionable-medusa-design.md
git commit -m "feat: schema de config de tenant, demo y locking con redis"
```

---

### Task 2: Paso 1 (valores iniciales), lock y CLI

**Files:**
- Create: `src/tenant/safe-link.ts`
- Create: `src/tenant/initial-defaults.ts`
- Create: `src/workflows/apply-tenant-config.ts`
- Create: `src/tenant/run-apply.ts`
- Create: `src/scripts/tenant-apply.ts`
- Create: `src/scripts/verify-tenant-apply.ts` (escenarios del paso 1; la Task 3 agrega los de marcas)
- Modify: `package.json` (script `tenant:apply`)

**Interfaces:**
- Consumes: `TenantConfig` (Task 1).
- Produces:
  - `safeLink(fn: () => Promise<unknown>): Promise<void>`
  - `BOOTSTRAP_MARKER = "tenant_bootstrapped_at"`
  - `applyInitialDefaults(container: MedusaContainer, config: TenantConfig): Promise<{ bootstrapped: boolean }>`
  - `applyTenantConfigWorkflow` (input `TenantConfig`, result `TenantApplyResult`)
  - `type TenantApplyResult = { bootstrapped: boolean; brands: BrandApplyResult[] }` (en esta task `brands` es `[]`; la Task 3 lo llena)
  - `type BrandApplyResult = { slug: string; active: boolean; sales_channel_id: string; publishable_key: string | null }`
  - `runTenantApply(container: MedusaContainer, config: TenantConfig): Promise<TenantApplyResult>`
  - `class TenantApplyLockedError extends Error`

- [ ] **Step 1: Escribir el script de escenarios (debe fallar)**

`src/scripts/verify-tenant-apply.ts`:

```ts
/**
 * Escenarios de apply sobre una DB DESECHABLE (ver plan, "Entorno de
 * verificación"). Aborta si la DB ya tiene datos de tenant.
 *   DATABASE_URL=$SCRATCH_DB_URL npx medusa exec ./src/scripts/verify-tenant-apply.ts
 */
import { readFileSync } from "fs"
import path from "path"
import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { TenantConfigSchema, type TenantConfig } from "../tenant/config-schema"
import { BOOTSTRAP_MARKER } from "../tenant/initial-defaults"
import { runTenantApply } from "../tenant/run-apply"

function loadDemo(): TenantConfig {
  const raw = JSON.parse(readFileSync(path.resolve(process.cwd(), "tenants/demo.json"), "utf8"))
  return TenantConfigSchema.parse(raw)
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`[verify-tenant-apply] FAIL: ${msg}`)
}

async function counts(container: MedusaContainer) {
  const m = (k: string) => container.resolve(k) as any
  return {
    regions: (await m(Modules.REGION).listRegions()).length,
    taxRegions: (await m(Modules.TAX).listTaxRegions()).length,
    stockLocations: (await m(Modules.STOCK_LOCATION).listStockLocations()).length,
    shippingOptions: (await m(Modules.FULFILLMENT).listShippingOptions()).length,
    fulfillmentSets: (await m(Modules.FULFILLMENT).listFulfillmentSets()).length,
    salesChannels: (await m(Modules.SALES_CHANNEL).listSalesChannels()).length,
    publishableKeys: (await m(Modules.API_KEY).listApiKeys({ type: "publishable" })).length,
  }
}

export default async function verifyTenantApply({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const storeModule = container.resolve(Modules.STORE)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // Guarda: solo DB vacía.
  const [store0] = await storeModule.listStores()
  const { data: products0 } = await query.graph({ entity: "product", fields: ["id"] })
  const { data: brands0 } = await query.graph({ entity: "brand", fields: ["id"] })
  assert(!store0?.metadata?.[BOOTSTRAP_MARKER], "la DB ya tiene tenant_bootstrapped_at; usa una DB desechable")
  assert(products0.length === 0 && brands0.length === 0, "la DB tiene productos o marcas; usa una DB desechable")

  const demo = loadDemo()

  // Escenario 1: primer apply crea los valores iniciales y marca la tienda.
  const r1 = await runTenantApply(container, demo)
  assert(r1.bootstrapped === true, "primer apply debe reportar bootstrapped=true")
  const [store1] = await storeModule.listStores()
  assert(typeof store1?.metadata?.[BOOTSTRAP_MARKER] === "string", "falta el marcador en store.metadata")
  const c1 = await counts(container)
  assert(c1.regions === 1 && c1.taxRegions === 1 && c1.stockLocations === 1, `iniciales inesperados: ${JSON.stringify(c1)}`)
  assert(c1.shippingOptions === demo.initial.shipping_options.length, `opciones de envío: ${c1.shippingOptions}`)
  logger.info("[verify-tenant-apply] OK escenario 1: valores iniciales")

  // Escenario 2: segundo apply idéntico no cambia nada.
  const r2 = await runTenantApply(container, demo)
  assert(r2.bootstrapped === false, "segundo apply debe reportar bootstrapped=false")
  const c2 = await counts(container)
  assert(JSON.stringify(c1) === JSON.stringify(c2), `conteos cambiaron: ${JSON.stringify(c1)} -> ${JSON.stringify(c2)}`)
  logger.info("[verify-tenant-apply] OK escenario 2: idempotente")

  // Escenario 5: initial no se re-aplica (precio editado y config cambiada).
  const fulfillment = container.resolve(Modules.FULFILLMENT) as any
  const [option] = await fulfillment.listShippingOptions({ name: demo.initial.shipping_options[0].name })
  const regionsBefore = await (container.resolve(Modules.REGION) as any).listRegions()
  const changed: TenantConfig = {
    ...demo,
    initial: {
      ...demo.initial,
      region: { ...demo.initial.region, name: "Otra Región" },
      shipping_options: [{ ...demo.initial.shipping_options[0], name: "Envío Nuevo", amount: 1 }],
    },
  }
  await runTenantApply(container, changed)
  const regionsAfter = await (container.resolve(Modules.REGION) as any).listRegions()
  const optionsAfter = await fulfillment.listShippingOptions({ name: "Envío Nuevo" })
  assert(regionsAfter.length === regionsBefore.length && regionsAfter[0].name === regionsBefore[0].name, "apply re-aplicó la región")
  assert(optionsAfter.length === 0, "apply creó una opción de envío de initial tras el bootstrap")
  assert((await fulfillment.listShippingOptions({ id: option.id })).length === 1, "apply tocó una opción existente")
  logger.info("[verify-tenant-apply] OK escenario 5: initial no se re-aplica")

  logger.info("[verify-tenant-apply] Todos los escenarios pasan.")
}
```

Run (DB desechable recién creada y migrada, ver "Entorno de verificación"):
```bash
DATABASE_URL="$SCRATCH_DB_URL" npx medusa exec ./src/scripts/verify-tenant-apply.ts 2>&1 | grep -E "verify-tenant-apply|rror" | head
```
Expected: FAIL (no existe `../tenant/initial-defaults` / `../tenant/run-apply`).

- [ ] **Step 2: Crear `src/tenant/safe-link.ts`**

```ts
/** Ignora errores de "ya existe" para que crear links sea idempotente. */
export async function safeLink(fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (error: any) {
    if (!/already exist|duplicate|unique/i.test(error?.message ?? "")) {
      throw error
    }
  }
}
```

- [ ] **Step 3: Crear `src/tenant/initial-defaults.ts`**

Lógica movida de la sección "0. Commerce fundamentals" de `src/scripts/seed.ts`, parametrizada con `config.initial`. Cada recurso se busca por clave natural antes de crear (permite reintentar y adoptar la DB existente).

```ts
/**
 * Paso 1 del apply: valores iniciales del tenant. Corre UNA sola vez: al final
 * escribe `store.metadata.tenant_bootstrapped_at`; si ya está, no hace nada
 * (después región, envíos y almacén los gestiona el admin de Medusa).
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  createTaxRegionsWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"
import type { TenantConfig } from "./config-schema"
import { safeLink } from "./safe-link"

export const BOOTSTRAP_MARKER = "tenant_bootstrapped_at"
const MANUAL_FULFILLMENT_PROVIDER = "manual_manual"

export async function applyInitialDefaults(
  container: MedusaContainer,
  config: TenantConfig
): Promise<{ bootstrapped: boolean }> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const storeModule = container.resolve(Modules.STORE)
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)
  const regionModule = container.resolve(Modules.REGION)
  const taxModule = container.resolve(Modules.TAX)
  const stockLocationModule = container.resolve(Modules.STOCK_LOCATION)
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT)

  let [store] = await storeModule.listStores()
  if (store?.metadata?.[BOOTSTRAP_MARKER]) {
    return { bootstrapped: false }
  }

  const { initial } = config
  logger.info("[tenant-apply] Aplicando valores iniciales del tenant...")

  // Canal default del store (fallback de Medusa; ningún storefront lo usa).
  let [defaultSalesChannel] = await salesChannelModule.listSalesChannels(
    {},
    { take: 1, order: { created_at: "ASC" } }
  )
  if (!defaultSalesChannel) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ name: "Default Sales Channel" }] },
    })
    defaultSalesChannel = result[0]
  }

  const storeFields = {
    name: config.store.name,
    supported_currencies: [{ currency_code: initial.currency, is_default: true }],
    default_sales_channel_id: defaultSalesChannel.id,
  }
  if (!store) {
    const { result } = await createStoresWorkflow(container).run({
      input: { stores: [storeFields] },
    })
    store = result[0]
  } else {
    await updateStoresWorkflow(container).run({
      input: { selector: { id: store.id }, update: storeFields },
    })
  }

  // Región.
  let [region] = await regionModule.listRegions({ name: initial.region.name })
  if (!region) {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: initial.region.name,
            currency_code: initial.currency,
            countries: initial.region.countries,
            payment_providers: initial.region.payment_providers,
          },
        ],
      },
    })
    region = result[0]
  }

  // Tax region por país. `provider_id` explícito: Medusa solo rellena
  // "tp_system" en regiones que existían al migrar (ver PENDIENTES.md).
  for (const country_code of initial.region.countries) {
    const existing = await taxModule.listTaxRegions({ country_code })
    if (existing.length === 0) {
      await createTaxRegionsWorkflow(container).run({
        input: [{ country_code, provider_id: "tp_system" }],
      })
    }
  }

  // Almacén + proveedor de fulfillment manual.
  let [stockLocation] = await stockLocationModule.listStockLocations({
    name: initial.stock_location.name,
  })
  if (!stockLocation) {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: { locations: [initial.stock_location] },
    })
    stockLocation = result[0]
  }
  await safeLink(() =>
    link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: MANUAL_FULFILLMENT_PROVIDER },
    })
  )

  // Fulfillment set + service zone con los países de la región. Nombre por
  // países ("Envíos MX"), el mismo que usaba el seed viejo: así se adopta.
  const fulfillmentSetName = `Envíos ${initial.region.countries.map((c) => c.toUpperCase()).join("/")}`
  let [fulfillmentSet] = await fulfillmentModule.listFulfillmentSets(
    { name: fulfillmentSetName },
    { relations: ["service_zones"] }
  )
  if (!fulfillmentSet) {
    fulfillmentSet = await fulfillmentModule.createFulfillmentSets({
      name: fulfillmentSetName,
      type: "shipping",
      service_zones: [
        {
          name: initial.region.name,
          geo_zones: initial.region.countries.map((country_code) => ({
            country_code,
            type: "country" as const,
          })),
        },
      ],
    })
    ;[fulfillmentSet] = await fulfillmentModule.listFulfillmentSets(
      { id: fulfillmentSet.id },
      { relations: ["service_zones"] }
    )
  }
  const serviceZone = fulfillmentSet.service_zones?.[0]
  await safeLink(() =>
    link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
      [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
    })
  )

  // Shipping profile default de Medusa.
  let [shippingProfile] = await fulfillmentModule.listShippingProfiles({ type: "default" })
  if (!shippingProfile) {
    const { result } = await createShippingProfilesWorkflow(container).run({
      input: { data: [{ name: "Default", type: "default" }] },
    })
    shippingProfile = result[0]
  }

  // Opciones de envío (solo las que falten, por nombre).
  if (serviceZone) {
    const existingNames = new Set(
      (
        await fulfillmentModule.listShippingOptions({
          name: initial.shipping_options.map((o) => o.name),
        })
      ).map((o) => o.name)
    )
    const missing = initial.shipping_options.filter((o) => !existingNames.has(o.name))
    if (missing.length > 0) {
      await createShippingOptionsWorkflow(container).run({
        input: missing.map((o) => ({
          name: o.name,
          price_type: "flat" as const,
          provider_id: MANUAL_FULFILLMENT_PROVIDER,
          service_zone_id: serviceZone.id,
          shipping_profile_id: shippingProfile.id,
          type: { label: o.label, description: o.description, code: o.code },
          prices: [
            { currency_code: initial.currency, amount: o.amount },
            { region_id: region.id, amount: o.amount },
          ],
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" as const },
            { attribute: "is_return", value: "false", operator: "eq" as const },
          ],
        })),
      })
    }
  }

  // Marcador al final: si algo falla antes, el próximo apply reintenta.
  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        metadata: { ...(store.metadata ?? {}), [BOOTSTRAP_MARKER]: new Date().toISOString() },
      },
    },
  })
  logger.info("[tenant-apply] Valores iniciales aplicados.")
  return { bootstrapped: true }
}
```

- [ ] **Step 4: Crear `src/workflows/apply-tenant-config.ts`** (solo paso 1 por ahora)

```ts
/**
 * Aplica la config de un tenant (spec 2026-10-16). Invocar SIEMPRE vía
 * runTenantApply() (src/tenant/run-apply.ts), que toma el lock.
 */
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import type { TenantConfig } from "../tenant/config-schema"
import { applyInitialDefaults } from "../tenant/initial-defaults"

export type BrandApplyResult = {
  slug: string
  active: boolean
  sales_channel_id: string
  publishable_key: string | null
}

export type TenantApplyResult = {
  bootstrapped: boolean
  brands: BrandApplyResult[]
}

const applyInitialDefaultsStep = createStep(
  "apply-tenant-initial-defaults",
  async (config: TenantConfig, { container }) => {
    return new StepResponse(await applyInitialDefaults(container, config))
  }
)

export const applyTenantConfigWorkflow = createWorkflow(
  "apply-tenant-config",
  (input: TenantConfig) => {
    const initial = applyInitialDefaultsStep(input)
    const result = transform({ initial }, (d): TenantApplyResult => ({
      bootstrapped: d.initial.bootstrapped,
      brands: [],
    }))
    return new WorkflowResponse(result)
  }
)
```

- [ ] **Step 5: Crear `src/tenant/run-apply.ts`**

```ts
/**
 * Única forma de correr el apply: toma el lock `tenant-apply` (Redis, sin
 * espera) para que server y CLI nunca apliquen a la vez.
 */
import { randomUUID } from "crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import type { TenantConfig } from "./config-schema"
import {
  applyTenantConfigWorkflow,
  type TenantApplyResult,
} from "../workflows/apply-tenant-config"

export const TENANT_APPLY_LOCK = "tenant-apply"
const LOCK_EXPIRE_SECONDS = 600

export class TenantApplyLockedError extends Error {
  constructor() {
    super("Ya hay un apply de tenant en curso")
  }
}

export async function runTenantApply(
  container: MedusaContainer,
  config: TenantConfig
): Promise<TenantApplyResult> {
  const locking = container.resolve(Modules.LOCKING)
  const ownerId = randomUUID()

  try {
    await locking.acquire(TENANT_APPLY_LOCK, { ownerId, expire: LOCK_EXPIRE_SECONDS })
  } catch (error: any) {
    if (error instanceof MedusaError && error.type === MedusaError.Types.CONFLICT) {
      throw new TenantApplyLockedError()
    }
    throw error
  }

  try {
    const { result } = await applyTenantConfigWorkflow(container).run({ input: config })
    return result
  } finally {
    await locking.release(TENANT_APPLY_LOCK, { ownerId })
  }
}
```

- [ ] **Step 6: Correr los escenarios**

Recrear la DB desechable (ver "Entorno de verificación") y correr:
```bash
DATABASE_URL="$SCRATCH_DB_URL" npx medusa exec ./src/scripts/verify-tenant-apply.ts 2>&1 | grep -E "verify-tenant-apply|rror" | head
```
Expected: `OK escenario 1`, `OK escenario 2`, `OK escenario 5`, `Todos los escenarios pasan.`

- [ ] **Step 7: Crear el CLI `src/scripts/tenant-apply.ts`**

```ts
/**
 * Aplica una config de tenant desde un archivo JSON.
 *   pnpm run tenant:apply tenants/demo.json
 */
import { readFileSync } from "fs"
import path from "path"
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { TenantConfigSchema } from "../tenant/config-schema"
import { runTenantApply } from "../tenant/run-apply"

export default async function tenantApply({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const file = args.find((a) => a !== "--")
  if (!file) {
    throw new Error("Uso: pnpm run tenant:apply <archivo.json>")
  }

  const raw = JSON.parse(readFileSync(path.resolve(process.cwd(), file), "utf8"))
  const parsed = TenantConfigSchema.safeParse(raw)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      logger.error(`[tenant-apply] ${issue.path.join(".")}: ${issue.message}`)
    }
    throw new Error("Config de tenant inválida")
  }

  const result = await runTenantApply(container, parsed.data)
  logger.info(`[tenant-apply] Resultado: ${JSON.stringify(result, null, 2)}`)
}
```

En `package.json`, dentro de `"scripts"`, agregar después de `"seed"`:

```json
    "tenant:apply": "medusa exec ./src/scripts/tenant-apply.ts",
```

Run (sobre la DB desechable ya aplicada):
```bash
DATABASE_URL="$SCRATCH_DB_URL" pnpm run tenant:apply tenants/demo.json 2>&1 | grep -E "tenant-apply|rror" | head
echo '{"version":2}' > /tmp/bad-tenant.json
DATABASE_URL="$SCRATCH_DB_URL" pnpm run tenant:apply /tmp/bad-tenant.json 2>&1 | grep -E "tenant-apply|inválida" | head
```
Expected: el primero imprime `"bootstrapped": false`; el segundo imprime los errores de campo y `Config de tenant inválida`.

- [ ] **Step 8: Typecheck y commit**

Run: `npx tsc --noEmit -p .` → Expected: sin salida (0 errores).

```bash
git add src/tenant/safe-link.ts src/tenant/initial-defaults.ts src/tenant/run-apply.ts src/workflows/apply-tenant-config.ts src/scripts/tenant-apply.ts src/scripts/verify-tenant-apply.ts package.json
git commit -m "feat: apply de tenant con valores iniciales, lock y cli"
```

---

### Task 3: Paso 2 (sincronizar marcas) e invariantes

**Files:**
- Create: `src/tenant/sync-brands.ts`
- Create: `src/tenant/invariants.ts`
- Modify: `src/workflows/apply-tenant-config.ts` (agregar el paso 2)
- Modify: `src/scripts/verify-brand-channels.ts` (reescribir completo)
- Modify: `src/scripts/verify-tenant-apply.ts` (escenarios 1b, 3 y 4)

**Interfaces:**
- Consumes: `TenantBrandConfig` (Task 1), `safeLink` (Task 2), `BrandApplyResult` / `TenantApplyResult` / `applyTenantConfigWorkflow` (Task 2), `BRAND_MODULE` de `src/modules/brand`.
- Produces:
  - `type CreatedBrandResources = { brandIds: string[]; channelIds: string[]; keyIds: string[] }`
  - `syncBrands(container: MedusaContainer, brands: TenantBrandConfig[]): Promise<{ results: BrandApplyResult[]; created: CreatedBrandResources }>`
  - `undoCreatedBrands(container: MedusaContainer, created: CreatedBrandResources): Promise<void>`
  - `checkTenancyInvariants(container: MedusaContainer): Promise<{ oks: string[]; failures: string[] }>`

- [ ] **Step 1: Agregar los escenarios de marcas (deben fallar)**

En `src/scripts/verify-tenant-apply.ts`:

1. Agregar el import:
```ts
import { checkTenancyInvariants } from "../tenant/invariants"
```

2. Agregar este helper debajo de `counts()`:
```ts
async function assertInvariants(container: MedusaContainer, label: string) {
  const { failures } = await checkTenancyInvariants(container)
  assert(failures.length === 0, `${label}: invariantes fallan:\n- ${failures.join("\n- ")}`)
}
```

3. Al final del escenario 1 (antes de su `logger.info`), agregar:
```ts
  assert(r1.brands.length === demo.brands.length, "resultado sin todas las marcas")
  assert(r1.brands.every((b) => b.active && b.publishable_key?.startsWith("pk_")), "marcas sin key")
  await assertInvariants(container, "escenario 1")
```

4. Antes de la línea final `logger.info("[verify-tenant-apply] Todos los escenarios pasan.")`, agregar:
```ts
  // Escenario 3: agregar una marca, renombrar otra y quitar una tercera.
  const brandModule = container.resolve("brandModuleService") as any
  const [urban, classic] = demo.brands
  const extra = { ...urban, slug: "acme-kids", name: "Acme Kids" }
  const s3: TenantConfig = {
    ...demo,
    brands: [{ ...urban, name: "Urban Street MX" }, extra], // classic queda fuera
  }
  const r3 = await runTenantApply(container, s3)
  await assertInvariants(container, "escenario 3")
  const urbanRes = r3.brands.find((b) => b.slug === urban.slug)!
  const { data: [urbanChannel] } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
    filters: { id: urbanRes.sales_channel_id },
  })
  assert(urbanChannel.name === "Urban Street MX", `canal no renombrado: ${urbanChannel.name}`)
  assert(r1.brands.find((b) => b.slug === urban.slug)!.sales_channel_id === urbanRes.sales_channel_id, "renombrar creó otro canal")
  const [classicRow] = await brandModule.listBrands({ slug: classic.slug })
  assert(classicRow && classicRow.active === false, "la marca quitada debe quedar inactiva, no borrada")
  logger.info("[verify-tenant-apply] OK escenario 3: agregar, renombrar, quitar")

  // Escenario 4: el cliente cambia colores; la marca sale y vuelve.
  const oldClassicKey = r1.brands.find((b) => b.slug === classic.slug)!.publishable_key
  await brandModule.updateBrands({ id: classicRow.id, primary_color: "#ABCDEF" })
  const r4 = await runTenantApply(container, demo)
  await assertInvariants(container, "escenario 4")
  const [classicBack] = await brandModule.listBrands({ slug: classic.slug })
  const classicRes = r4.brands.find((b) => b.slug === classic.slug)!
  assert(classicBack.active === true, "la marca no se reactivó")
  assert(classicBack.primary_color === "#ABCDEF", "apply pisó la apariencia editada por el cliente")
  assert(classicRes.publishable_key && classicRes.publishable_key !== oldClassicKey, "reactivar debe dar key nueva")
  logger.info("[verify-tenant-apply] OK escenario 4: reactivación conserva apariencia")
```

Run (DB desechable recreada y migrada):
```bash
DATABASE_URL="$SCRATCH_DB_URL" npx medusa exec ./src/scripts/verify-tenant-apply.ts 2>&1 | grep -E "verify-tenant-apply|rror" | head
```
Expected: FAIL (no existe `../tenant/invariants`).

- [ ] **Step 2: Crear `src/tenant/sync-brands.ts`**

```ts
/**
 * Paso 2 del apply: sincroniza las marcas de la config. `slug` es la
 * identidad; el canal se encuentra por el link brand↔sales_channel. Nunca
 * borra marcas: las desactiva (canal deshabilitado, keys revocadas). La
 * apariencia solo se usa al crear (después la edita el cliente en Medusa).
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createSalesChannelsWorkflow,
  deleteApiKeysWorkflow,
  deleteSalesChannelsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  revokeApiKeysWorkflow,
  updateApiKeysWorkflow,
  updateSalesChannelsWorkflow,
} from "@medusajs/medusa/core-flows"
import { BRAND_MODULE } from "../modules/brand"
import type BrandModuleService from "../modules/brand/service"
import type { TenantBrandConfig } from "./config-schema"
import type { BrandApplyResult } from "../workflows/apply-tenant-config"

export type CreatedBrandResources = {
  brandIds: string[]
  channelIds: string[]
  keyIds: string[]
}

type ExistingBrand = {
  id: string
  slug: string
  name: string
  active: boolean
  sales_channel?: { id: string; name: string; is_disabled: boolean } | null
}

type PublishableKey = {
  id: string
  title: string
  token: string
  revoked_at: string | Date | null
  sales_channels?: { id: string }[]
}

const keyTitle = (brandName: string) => `${brandName} Storefront`

export async function syncBrands(
  container: MedusaContainer,
  brands: TenantBrandConfig[]
): Promise<{ results: BrandApplyResult[]; created: CreatedBrandResources }> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const brandService: BrandModuleService = container.resolve(BRAND_MODULE)
  const stockLocationModule = container.resolve(Modules.STOCK_LOCATION)
  const created: CreatedBrandResources = { brandIds: [], channelIds: [], keyIds: [] }

  const { data: existingRows } = await query.graph({
    entity: "brand",
    fields: ["id", "slug", "name", "active", "sales_channel.id", "sales_channel.name", "sales_channel.is_disabled"],
  })
  const existingBySlug = new Map(
    (existingRows as unknown as ExistingBrand[]).map((b) => [b.slug, b])
  )

  const { data: keyRows } = await query.graph({
    entity: "api_key",
    fields: ["id", "title", "token", "revoked_at", "sales_channels.id"],
    filters: { type: "publishable" },
  })
  const keys = keyRows as unknown as PublishableKey[]
  const liveKeysOf = (channelId: string) =>
    keys.filter((k) => !k.revoked_at && (k.sales_channels ?? []).some((sc) => sc.id === channelId))

  const stockLocationIds = (await stockLocationModule.listStockLocations({})).map((l) => l.id)

  const revokeKeys = async (ids: string[]) => {
    if (ids.length === 0) return
    await revokeApiKeysWorkflow(container).run({
      input: { selector: { id: ids }, revoke: { revoked_by: "tenant-apply" } },
    })
  }

  const results: BrandApplyResult[] = []

  for (const cfg of brands) {
    let brand = existingBySlug.get(cfg.slug)

    // 1. Marca.
    if (!brand) {
      const createdBrand = await brandService.createBrands({
        slug: cfg.slug,
        name: cfg.name,
        active: cfg.active,
        description: cfg.description,
        logo_url: cfg.logo_url,
        primary_color: cfg.primary_color,
        secondary_color: cfg.secondary_color,
      })
      created.brandIds.push(createdBrand.id)
      brand = { id: createdBrand.id, slug: cfg.slug, name: cfg.name, active: cfg.active, sales_channel: null }
    } else if (brand.name !== cfg.name || brand.active !== cfg.active) {
      await brandService.updateBrands({ id: brand.id, name: cfg.name, active: cfg.active })
    }

    // 2. Sales channel (por link, nunca por nombre).
    let channelId = brand.sales_channel?.id
    if (!channelId) {
      const { result } = await createSalesChannelsWorkflow(container).run({
        input: { salesChannelsData: [{ name: cfg.name, is_disabled: !cfg.active }] },
      })
      channelId = result[0].id
      created.channelIds.push(channelId)
      await link.create({
        [BRAND_MODULE]: { brand_id: brand.id },
        [Modules.SALES_CHANNEL]: { sales_channel_id: channelId },
      })
    } else if (
      brand.sales_channel!.name !== cfg.name ||
      brand.sales_channel!.is_disabled !== !cfg.active
    ) {
      await updateSalesChannelsWorkflow(container).run({
        input: { selector: { id: channelId }, update: { name: cfg.name, is_disabled: !cfg.active } },
      })
    }

    // 3. Canal visible en todos los almacenes del tenant.
    for (const locationId of stockLocationIds) {
      await linkSalesChannelsToStockLocationWorkflow(container).run({
        input: { id: locationId, add: [channelId] },
      })
    }

    // 4. Publishable key.
    const live = liveKeysOf(channelId)
    let publishableKey: string | null = null
    if (cfg.active) {
      let key = live[0]
      if (!key) {
        const { result } = await createApiKeysWorkflow(container).run({
          input: { api_keys: [{ title: keyTitle(cfg.name), type: "publishable", created_by: "tenant-apply" }] },
        })
        const newKey = result[0]
        created.keyIds.push(newKey.id)
        await linkSalesChannelsToApiKeyWorkflow(container).run({
          input: { id: newKey.id, add: [channelId] },
        })
        key = { id: newKey.id, title: newKey.title, token: newKey.token, revoked_at: null }
      } else if (key.title !== keyTitle(cfg.name)) {
        await updateApiKeysWorkflow(container).run({
          input: { selector: { id: key.id }, update: { title: keyTitle(cfg.name) } },
        })
      }
      publishableKey = key.token
    } else {
      await revokeKeys(live.map((k) => k.id))
    }

    results.push({
      slug: cfg.slug,
      active: cfg.active,
      sales_channel_id: channelId,
      publishable_key: publishableKey,
    })
  }

  // 5. Marcas en la DB que ya no están en la config: desactivar.
  const configSlugs = new Set(brands.map((b) => b.slug))
  for (const brand of existingBySlug.values()) {
    if (configSlugs.has(brand.slug)) continue
    if (brand.active) {
      await brandService.updateBrands({ id: brand.id, active: false })
    }
    const channelId = brand.sales_channel?.id
    if (channelId) {
      if (!brand.sales_channel!.is_disabled) {
        await updateSalesChannelsWorkflow(container).run({
          input: { selector: { id: channelId }, update: { is_disabled: true } },
        })
      }
      await revokeKeys(liveKeysOf(channelId).map((k) => k.id))
    }
  }

  return { results, created }
}

/** Compensación del paso 2: borra lo que este apply creó. */
export async function undoCreatedBrands(
  container: MedusaContainer,
  created: CreatedBrandResources
) {
  const brandService: BrandModuleService = container.resolve(BRAND_MODULE)
  if (created.keyIds.length > 0) {
    await revokeApiKeysWorkflow(container).run({
      input: { selector: { id: created.keyIds }, revoke: { revoked_by: "tenant-apply-rollback" } },
    })
    await deleteApiKeysWorkflow(container).run({ input: { ids: created.keyIds } })
  }
  if (created.channelIds.length > 0) {
    await deleteSalesChannelsWorkflow(container).run({ input: { ids: created.channelIds } })
  }
  if (created.brandIds.length > 0) {
    await brandService.deleteBrands(created.brandIds)
  }
}
```

- [ ] **Step 3: Conectar el paso 2 en `src/workflows/apply-tenant-config.ts`**

Agregar los imports:
```ts
import type { TenantBrandConfig } from "../tenant/config-schema"
import { syncBrands, undoCreatedBrands } from "../tenant/sync-brands"
```

Agregar el step debajo de `applyInitialDefaultsStep`:
```ts
const syncBrandsStep = createStep(
  "sync-tenant-brands",
  async (brands: TenantBrandConfig[], { container }) => {
    const { results, created } = await syncBrands(container, brands)
    return new StepResponse(results, created)
  },
  async (created, { container }) => {
    if (!created) return
    await undoCreatedBrands(container, created)
  }
)
```

Reemplazar el cuerpo del workflow por:
```ts
  (input: TenantConfig) => {
    // Orden secuencial: las marcas se ligan al almacén creado en el paso 1.
    const initial = applyInitialDefaultsStep(input)
    const brands = syncBrandsStep(input.brands)
    const result = transform({ initial, brands }, (d): TenantApplyResult => ({
      bootstrapped: d.initial.bootstrapped,
      brands: d.brands,
    }))
    return new WorkflowResponse(result)
  }
```

- [ ] **Step 4: Crear `src/tenant/invariants.ts`**

```ts
/**
 * Invariantes de tenancy multi-marca, sin nombres de marca escritos a mano.
 * Usado por verify-brand-channels.ts y verify-tenant-apply.ts.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { BOOTSTRAP_MARKER } from "./initial-defaults"

export async function checkTenancyInvariants(
  container: MedusaContainer
): Promise<{ oks: string[]; failures: string[] }> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const storeModule = container.resolve(Modules.STORE)
  const oks: string[] = []
  const failures: string[] = []

  const [store] = await storeModule.listStores()
  if (store?.metadata?.[BOOTSTRAP_MARKER]) oks.push("tienda con tenant_bootstrapped_at")
  else failures.push("la tienda no tiene tenant_bootstrapped_at")

  const { data: brands } = await query.graph({
    entity: "brand",
    fields: [
      "id", "slug", "name", "active",
      "sales_channel.id", "sales_channel.is_disabled", "sales_channel.stock_locations.id",
    ],
  })
  const { data: keys } = await query.graph({
    entity: "api_key",
    fields: ["id", "title", "revoked_at", "sales_channels.id"],
    filters: { type: "publishable" },
  })
  const channelByBrandSlug: Record<string, string> = {}

  for (const b of brands as any[]) {
    const ch = b.sales_channel
    if (!ch?.id) {
      failures.push(`marca "${b.slug}" sin sales channel`)
      continue
    }
    channelByBrandSlug[b.slug] = ch.id
    const live = (keys as any[]).filter(
      (k) => !k.revoked_at && (k.sales_channels ?? []).some((sc: any) => sc.id === ch.id)
    )
    if (b.active) {
      if (ch.is_disabled) failures.push(`marca activa "${b.slug}" con canal deshabilitado`)
      if (!(ch.stock_locations ?? []).length) failures.push(`canal de "${b.slug}" sin almacén`)
      if (live.length !== 1) failures.push(`marca "${b.slug}" con ${live.length} keys vigentes (se espera 1)`)
      else if ((live[0].sales_channels ?? []).length !== 1)
        failures.push(`key de "${b.slug}" apunta a ${live[0].sales_channels.length} canales (se espera 1)`)
      else oks.push(`marca activa "${b.slug}" con canal, almacén y una key`)
    } else {
      if (!ch.is_disabled) failures.push(`marca inactiva "${b.slug}" con canal habilitado`)
      if (live.length > 0) failures.push(`marca inactiva "${b.slug}" con ${live.length} keys vigentes`)
      if (ch.is_disabled && live.length === 0) oks.push(`marca inactiva "${b.slug}" sin canal ni keys vigentes`)
    }
  }

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "brand.slug", "sales_channels.id"],
  })
  for (const p of products as any[]) {
    const expected = p.brand?.slug ? channelByBrandSlug[p.brand.slug] : undefined
    const ids = (p.sales_channels ?? []).map((c: any) => c.id)
    if (!expected) failures.push(`producto "${p.title}" sin marca con canal`)
    else if (ids.length !== 1 || ids[0] !== expected)
      failures.push(`producto "${p.title}" en ${ids.length} canal(es), se espera solo el de su marca`)
  }
  if ((products as any[]).length > 0) oks.push(`${products.length} productos revisados`)

  return { oks, failures }
}
```

- [ ] **Step 5: Reescribir `src/scripts/verify-brand-channels.ts`**

Reemplazar el archivo completo por:

```ts
/**
 * Probe de tenancy multi-marca (sin nombres a mano).
 *   npx medusa exec ./src/scripts/verify-brand-channels.ts
 */
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { checkTenancyInvariants } from "../tenant/invariants"

export default async function verifyBrandChannels({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { oks, failures } = await checkTenancyInvariants(container)
  oks.forEach((m) => logger.info(`[verify] OK ${m}`))
  failures.forEach((m) => logger.error(`[verify] FAIL: ${m}`))

  // El path del graph del que depende el cart guard debe resolver.
  try {
    const { data } = await query.graph({
      entity: "variant",
      fields: ["id", "product.sales_channels.id"],
      pagination: { take: 1 },
    })
    const row = (data as any[])[0]
    if (row && !Array.isArray(row.product?.sales_channels)) {
      failures.push("variant->product.sales_channels no resuelve (cart guard)")
    }
  } catch (e: any) {
    failures.push(`variant->product.sales_channels lanzó: ${e?.message ?? e}`)
  }

  if (failures.length > 0) {
    throw new Error(`[verify] ${failures.length} invariante(s) fallaron:\n- ${failures.join("\n- ")}`)
  }
  logger.info("[verify] Todas las invariantes de tenancy se cumplen.")
}
```

- [ ] **Step 6: Correr los escenarios**

Recrear la DB desechable y correr:
```bash
DATABASE_URL="$SCRATCH_DB_URL" npx medusa exec ./src/scripts/verify-tenant-apply.ts 2>&1 | grep -E "verify-tenant-apply|rror" | head
```
Expected: `OK escenario 1`, `2`, `5`, `3`, `4` y `Todos los escenarios pasan.`

Run también el probe sobre la desechable:
```bash
DATABASE_URL="$SCRATCH_DB_URL" npx medusa exec ./src/scripts/verify-brand-channels.ts 2>&1 | grep -E "\[verify\]" | tail -3
```
Expected: `Todas las invariantes de tenancy se cumplen.`

- [ ] **Step 7: Typecheck y commit**

Run: `npx tsc --noEmit -p .` → Expected: 0 errores.

```bash
git add src/tenant/sync-brands.ts src/tenant/invariants.ts src/workflows/apply-tenant-config.ts src/scripts/verify-brand-channels.ts src/scripts/verify-tenant-apply.ts
git commit -m "feat: sincronizar marcas del tenant con canal y publishable key"
```

---

### Task 4: Endpoint `POST /internal/tenant/apply`

**Files:**
- Create: `src/utils/control-plane-auth.ts`
- Create: `src/api/internal/tenant/apply/route.ts`
- Modify: `src/api/middlewares.ts` (import + ruta nueva al final de `routes`)

**Interfaces:**
- Consumes: `TenantConfigSchema` (Task 1), `runTenantApply` / `TenantApplyLockedError` (Task 2).
- Produces: `requireControlPlaneToken(): MiddlewareFunction`; endpoint `POST /internal/tenant/apply` con la respuesta `TenantApplyResult`.

- [ ] **Step 1: Escribir las pruebas con curl (deben fallar)**

Guardar como `/tmp/tenant-endpoint.sh`:
```bash
B=localhost:9100
DEMO=tenants/demo.json
echo "1) sin token:";       curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/internal/tenant/apply -H 'Content-Type: application/json' -d @$DEMO
echo "2) token malo:";      curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/internal/tenant/apply -H 'Content-Type: application/json' -H 'Authorization: Bearer nope' -d @$DEMO
echo "3) body inválido:";   curl -s -w " %{http_code}\n" -X POST $B/internal/tenant/apply -H 'Content-Type: application/json' -H "Authorization: Bearer $CONTROL_PLANE_TOKEN" -d '{"version":2}' | tail -c 200
echo "4) correcto:";        curl -s -w " %{http_code}\n" -X POST $B/internal/tenant/apply -H 'Content-Type: application/json' -H "Authorization: Bearer $CONTROL_PLANE_TOKEN" -d @$DEMO | tail -c 300
echo "5) concurrentes:"
for i in 1 2; do curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/internal/tenant/apply -H 'Content-Type: application/json' -H "Authorization: Bearer $CONTROL_PLANE_TOKEN" -d @$DEMO & done; wait
```

Levantar el servidor contra la DB desechable **con** token (ver "Entorno de verificación"):
```bash
export CONTROL_PLANE_TOKEN=test-token-123
DATABASE_URL="$SCRATCH_DB_URL" CONTROL_PLANE_TOKEN=$CONTROL_PLANE_TOKEN bash -c '(npx medusa develop --port 9100 > /tmp/medusa-dev.log 2>&1 &)'
until curl -sf localhost:9100/health >/dev/null; do sleep 2; done
bash /tmp/tenant-endpoint.sh
```
Expected: FAIL. Todas responden 404 (la ruta no existe todavía). Detener el servidor (comando del "Entorno de verificación").

- [ ] **Step 2: Crear `src/utils/control-plane-auth.ts`**

```ts
/**
 * Auth del control plane para /internal/*: Bearer <CONTROL_PLANE_TOKEN>.
 * Sin token configurado la ruta "no existe" (404), así un tenant mal
 * configurado no queda expuesto.
 */
import { createHash, timingSafeEqual } from "crypto"
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const digest = (value: string) => createHash("sha256").update(value).digest()

export function requireControlPlaneToken() {
  return (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
    const expected = process.env.CONTROL_PLANE_TOKEN
    if (!expected) {
      return res.status(404).json({ type: "not_found", message: "Not found" })
    }
    const header = req.headers.authorization ?? ""
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : ""
    // Comparar digests: mismo largo siempre, tiempo constante.
    if (!token || !timingSafeEqual(digest(token), digest(expected))) {
      return res.status(401).json({ type: "unauthorized", message: "Token de control plane inválido" })
    }
    return next()
  }
}
```

- [ ] **Step 3: Crear `src/api/internal/tenant/apply/route.ts`**

```ts
/**
 * POST /internal/tenant/apply — el control plane empuja la config del tenant.
 * Auth: requireControlPlaneToken() (src/api/middlewares.ts).
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { TenantConfigSchema } from "../../../../tenant/config-schema"
import { runTenantApply, TenantApplyLockedError } from "../../../../tenant/run-apply"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = TenantConfigSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      type: "invalid_data",
      message: "Config de tenant inválida",
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    })
  }

  try {
    const result = await runTenantApply(req.scope, parsed.data)
    return res.json(result)
  } catch (error) {
    if (error instanceof TenantApplyLockedError) {
      return res.status(409).json({ type: "conflict", message: error.message })
    }
    throw error
  }
}
```

- [ ] **Step 4: Cablear el middleware en `src/api/middlewares.ts`**

Agregar el import junto a los demás de `../utils/...`:
```ts
import { requireControlPlaneToken } from "../utils/control-plane-auth"
```

Agregar al final del arreglo `routes` (después de la ruta `/store/carts/:id/complete`):
```ts
    // ==================
    // Internal (control plane) — Bearer CONTROL_PLANE_TOKEN
    // ==================
    {
      matcher: "/internal/tenant/apply",
      method: "POST",
      middlewares: [requireControlPlaneToken()],
    },
```

- [ ] **Step 5: Correr las pruebas**

Recrear la DB desechable, levantar el servidor **con** `CONTROL_PLANE_TOKEN=test-token-123` (Step 1) y correr `bash /tmp/tenant-endpoint.sh`.
Expected:
- 1) `401`
- 2) `401`
- 3) `... "message":"Config de tenant inválida" ... 400`
- 4) JSON con `"bootstrapped":true` y dos marcas con `"publishable_key":"pk_..."`, `200`
- 5) un `200` y un `409` (en cualquier orden)

Detener el servidor y levantarlo **sin** `CONTROL_PLANE_TOKEN`:
```bash
DATABASE_URL="$SCRATCH_DB_URL" bash -c 'unset CONTROL_PLANE_TOKEN; (npx medusa develop --port 9100 > /tmp/medusa-dev.log 2>&1 &)'
until curl -sf localhost:9100/health >/dev/null; do sleep 2; done
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:9100/internal/tenant/apply -H 'Content-Type: application/json' -H 'Authorization: Bearer test-token-123' -d @tenants/demo.json
```
Expected: `404`. Detener el servidor.

- [ ] **Step 6: Verificar que el lock se libera tras un fallo**

Con el servidor **con** token sobre la DB desechable ya aplicada, mandar una config que falle dentro del workflow (región con proveedor de pago inexistente sobre una DB nueva fuerza el error en el paso 1):
```bash
docker exec medusa-postgres psql -U medusa -d postgres -c "drop database if exists medusa_tenant_scratch with (force)" -c "create database medusa_tenant_scratch"
DATABASE_URL="$SCRATCH_DB_URL" npx medusa db:migrate >/dev/null
# (levantar el server con token, Step 1)
python3 -c "import json;d=json.load(open('tenants/demo.json'));d['initial']['region']['payment_providers']=['pp_no_existe'];json.dump(d,open('/tmp/bad-provider.json','w'))"
curl -s -o /dev/null -w "falla: %{http_code}\n" -X POST localhost:9100/internal/tenant/apply -H 'Content-Type: application/json' -H "Authorization: Bearer $CONTROL_PLANE_TOKEN" -d @/tmp/bad-provider.json
curl -s -o /dev/null -w "después: %{http_code}\n" -X POST localhost:9100/internal/tenant/apply -H 'Content-Type: application/json' -H "Authorization: Bearer $CONTROL_PLANE_TOKEN" -d @tenants/demo.json
```
Expected: `falla: 4xx` o `5xx` (no `409`) y `después: 200` (el lock se liberó y el reintento converge). Detener el servidor.

- [ ] **Step 7: Typecheck y commit**

Run: `npx tsc --noEmit -p .` → Expected: 0 errores.

```bash
git add src/utils/control-plane-auth.ts src/api/internal/tenant/apply/route.ts src/api/middlewares.ts
git commit -m "feat: endpoint interno para que el control plane aplique la config del tenant"
```

---

### Task 5: Marcas de solo lectura en el admin de Medusa (salvo apariencia)

**Files:**
- Modify: `src/api/middlewares.ts:11-23` (schemas de marca) y la ruta `POST /admin/brands`
- Modify: `src/api/admin/brands/route.ts` (handler `POST`)
- Modify: `src/api/admin/brands/[id]/route.ts` (handlers `POST` y `DELETE`)
- Modify: `src/admin/lib/api.ts` (`createBrand`, `updateBrand`, `deleteBrand`)
- Modify: `src/admin/routes/brands/page.tsx`
- Modify: `src/admin/routes/brands/[id]/page.tsx`
- Delete: `src/admin/routes/brands/create/page.tsx`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `updateBrand(id: string, data: BrandAppearance): Promise<Brand>` con `type BrandAppearance = Partial<Pick<Brand, "logo_url" | "primary_color" | "secondary_color" | "description">>` exportado desde `src/admin/lib/api.ts`. `createBrand` y `deleteBrand` dejan de existir.

- [ ] **Step 1: Escribir las pruebas con curl (deben fallar)**

Se prueba sobre la **DB desechable** (crear/borrar marcas no debe tocar la de desarrollo). Prepararla: recrearla, migrar, aplicar la demo y crear el admin:
```bash
docker exec medusa-postgres psql -U medusa -d postgres -c "drop database if exists medusa_tenant_scratch with (force)" -c "create database medusa_tenant_scratch"
DATABASE_URL="$SCRATCH_DB_URL" npx medusa db:migrate >/dev/null
DATABASE_URL="$SCRATCH_DB_URL" pnpm run tenant:apply tenants/demo.json >/dev/null
DATABASE_URL="$SCRATCH_DB_URL" npx medusa user -e admin@example.com -p supersecret
```

Guardar como `/tmp/admin-brands.sh`:
```bash
B=localhost:9100
T=$(curl -s $B/auth/user/emailpass -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"supersecret"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
H=(-H "Authorization: Bearer $T" -H 'Content-Type: application/json')
ID=$(curl -s "$B/admin/brands" "${H[@]}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["brands"][0]["id"])')
echo "antes:";         curl -s "$B/admin/brands/$ID" "${H[@]}" | python3 -c 'import sys,json;b=json.load(sys.stdin)["brand"];print(b["name"],b["active"],b["primary_color"])'
echo "crear:";         curl -s -o /dev/null -w "%{http_code}\n" $B/admin/brands "${H[@]}" -d '{"name":"X","slug":"x"}'
echo "borrar:";        curl -s -o /dev/null -w "%{http_code}\n" -X DELETE $B/admin/brands/$ID "${H[@]}"
echo "editar name:";   curl -s -o /dev/null -w "%{http_code}\n" $B/admin/brands/$ID "${H[@]}" -d '{"name":"Otro"}'
echo "editar active:"; curl -s -o /dev/null -w "%{http_code}\n" $B/admin/brands/$ID "${H[@]}" -d '{"active":false}'
echo "editar color:";  curl -s -w " %{http_code}\n" $B/admin/brands/$ID "${H[@]}" -d '{"primary_color":"#123456","description":"nueva"}' | tail -c 160
echo "después:";       curl -s "$B/admin/brands/$ID" "${H[@]}" | python3 -c 'import sys,json;b=json.load(sys.stdin)["brand"];print(b["name"],b["active"],b["primary_color"])'
```

Levantar el servidor sobre la DB desechable (`DATABASE_URL="$SCRATCH_DB_URL"`, ver "Entorno de verificación") y correr `bash /tmp/admin-brands.sh`.
Expected: FAIL. Hoy `crear` da `201`, `borrar` `200` y `editar name` `200`. Detener el servidor.

- [ ] **Step 2: Restringir los schemas en `src/api/middlewares.ts`**

Reemplazar las líneas de `createBrandSchema` y `updateBrandSchema` (hoy `src/api/middlewares.ts:11-23`) por:

```ts
// Brand validation schemas. Estructura de marca (nombre, slug, activa) la
// manda el control plane vía /internal/tenant/apply; en el admin solo se
// edita la apariencia (spec 2026-10-16).
const updateBrandAppearanceSchema = z
  .object({
    logo_url: z.string().url().optional().nullable(),
    primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color").optional(),
    secondary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color").optional(),
    description: z.string().optional().nullable(),
  })
  .strict()
```

Borrar la entrada de `routes` con `matcher: "/admin/brands", method: "POST"` (la que usa `validateAndTransformBody(createBrandSchema)`).

En la entrada `matcher: "/admin/brands/:id", method: "POST"`, cambiar `validateAndTransformBody(updateBrandSchema)` por `validateAndTransformBody(updateBrandAppearanceSchema)`.

- [ ] **Step 3: Handlers de la API**

En `src/api/admin/brands/route.ts`, reemplazar la función `POST` completa por:
```ts
// Las marcas se crean desde el control plane (POST /internal/tenant/apply).
export async function POST(_req: MedusaRequest, res: MedusaResponse) {
  res.status(403).json({
    type: "not_allowed",
    message: "Las marcas se crean desde el control plane del tenant.",
  })
}
```
Si `BRAND_MODULE` o `BrandModuleService` quedan sin usar en ese archivo tras el cambio, no los borres: el `GET` los sigue usando (verificar con `npx tsc --noEmit -p .`).

En `src/api/admin/brands/[id]/route.ts`, reemplazar la función `POST` completa por:
```ts
// Solo apariencia; nombre, slug y estado los manda el control plane.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)
  const { id } = req.params
  const { logo_url, primary_color, secondary_color, description } = req.validatedBody as {
    logo_url?: string | null
    primary_color?: string
    secondary_color?: string
    description?: string | null
  }

  const brand = await brandService.updateBrands({
    id,
    logo_url,
    primary_color,
    secondary_color,
    description,
  })

  res.json({ brand })
}
```

y la función `DELETE` completa (con su comentario) por:
```ts
// Las marcas nunca se borran: se desactivan desde el control plane.
export async function DELETE(_req: MedusaRequest, res: MedusaResponse) {
  res.status(403).json({
    type: "not_allowed",
    message: "Las marcas se desactivan desde el control plane del tenant.",
  })
}
```

- [ ] **Step 4: UI del admin**

`src/admin/lib/api.ts`:
- Borrar las funciones `createBrand` y `deleteBrand` completas.
- Reemplazar `updateBrand` por:
```ts
export type BrandAppearance = Partial<
  Pick<Brand, "logo_url" | "primary_color" | "secondary_color" | "description">
>

/**
 * Update brand appearance (name/slug/active come from the control plane)
 */
export async function updateBrand(id: string, data: BrandAppearance): Promise<Brand> {
  const response = await fetch(`${API_BASE}/brands/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || "Failed to update brand")
  }

  const result = await response.json()
  return result.brand
}
```

Borrar `src/admin/routes/brands/create/page.tsx`:
```bash
git rm src/admin/routes/brands/create/page.tsx
```

`src/admin/routes/brands/page.tsx`:
- Cambiar el import `import { fetchBrands, deleteBrand } from "../../lib/api"` por `import { fetchBrands } from "../../lib/api"`.
- Borrar la función `handleDelete` completa (empieza en `const handleDelete = async (brand: Brand) => {`).
- Borrar los dos `<Button onClick={() => navigate("/brands/create")}>…</Button>` (encabezado y estado vacío). En el estado vacío, en su lugar dejar:
```tsx
          <Text size="small" className="text-ui-fg-muted">
            Las marcas se dan de alta desde el control plane del tenant.
          </Text>
```
- En el `DropdownMenu` de cada fila, borrar el `DropdownMenu.Item` que llama `handleDelete(brand)` (y su `DropdownMenu.Separator` previo si lo hay). Dejar solo "Editar".
- Quitar imports que queden sin usar (`Plus`, `Trash`, `usePrompt`, etc.); `npx tsc --noEmit -p .` los señala.

`src/admin/routes/brands/[id]/page.tsx`:
- Cambiar el import `import { fetchBrand, updateBrand, deleteBrand } from "../../../lib/api"` por `import { fetchBrand, updateBrand } from "../../../lib/api"`.
- En `handleSubmit`, reemplazar la llamada `await updateBrand(id, { ... })` por:
```tsx
      await updateBrand(id, {
        description: formData.description || null,
        logo_url: formData.logo_url || null,
        primary_color: formData.primary_color,
        secondary_color: formData.secondary_color,
      })
```
- Borrar la función `handleDelete` completa.
- En los `<Input id="name" ...>` y `<Input id="slug" ...>`: quitar `onChange` y `required`, agregar `disabled`.
- En el `<Switch id="active" ...>`: quitar `onCheckedChange`, agregar `disabled`.
- Debajo del `<Heading level="h2" className="mb-4">Información básica</Heading>`, agregar:
```tsx
          <Text size="small" className="text-ui-fg-muted">
            Nombre, slug y estado se gestionan desde el control plane del tenant.
          </Text>
```
- Borrar el bloque completo `{/* Danger Zone */}` (el `<div>` con el botón "Eliminar marca").
- Quitar imports sin usar (`Trash`, `usePrompt`, etc.).

- [ ] **Step 5: Correr las pruebas**

Run: `npx tsc --noEmit -p .` → Expected: 0 errores.

Repetir la preparación de la DB desechable del Step 1 (recrear, migrar, `tenant:apply`, `medusa user`), levantar el servidor sobre ella y correr `bash /tmp/admin-brands.sh`.
Expected:
- crear `403`
- borrar `403`
- editar name `400`
- editar active `400`
- editar color: JSON con `"primary_color":"#123456"` y `200`
- después: mismo `name` y `active` que en "antes", `primary_color` `#123456`

Detener el servidor.

- [ ] **Step 6: Build y commit**

Run: `pnpm run build 2>&1 | grep -E "completed|rror"` → Expected: backend y frontend `completed successfully`.

```bash
git add src/api/middlewares.ts src/api/admin/brands src/admin/lib/api.ts src/admin/routes/brands
git commit -m "feat: marcas de solo lectura en el admin salvo su apariencia"
```

---

### Task 6: Demo como un tenant más (`seed-demo.ts`)

**Files:**
- Move: `src/scripts/seed.ts` → `src/scripts/seed-demo.ts`
- Modify: `src/scripts/seed-demo.ts` (recortar)
- Modify: `package.json` (script `seed`)

**Interfaces:**
- Consumes: `TenantConfigSchema` (Task 1), `runTenantApply` (Task 2), resultado `TenantApplyResult.brands` (Task 3), `checkTenancyInvariants` vía el probe (Task 3).
- Produces: `pnpm run seed` = apply de `tenants/demo.json` + datos de demo, idempotente.

- [ ] **Step 1: Registrar el estado actual de la DB de desarrollo (línea base)**

Con la DB de desarrollo (`DATABASE_URL="$DEV_DB_URL"`), guardar el script de conteos `/tmp/dev-counts.sh`:
```bash
docker exec medusa-postgres psql -U medusa -d medusa_db -Atc "
select 'regions', count(*) from region where deleted_at is null union all
select 'tax_regions', count(*) from tax_region where deleted_at is null union all
select 'stock_locations', count(*) from stock_location where deleted_at is null union all
select 'shipping_options', count(*) from shipping_option where deleted_at is null union all
select 'fulfillment_sets', count(*) from fulfillment_set where deleted_at is null union all
select 'sales_channels', count(*) from sales_channel where deleted_at is null union all
select 'publishable_keys', count(*) from api_key where type='publishable' and deleted_at is null union all
select 'brands', count(*) from brand where deleted_at is null union all
select 'products', count(*) from product where deleted_at is null;"
```
Run: `bash /tmp/dev-counts.sh > /tmp/dev-counts-before.txt; cat /tmp/dev-counts-before.txt`
Expected: conteos actuales (anótalos; se comparan en el Step 4).

- [ ] **Step 2: Mover y recortar el seed**

```bash
git mv src/scripts/seed.ts src/scripts/seed-demo.ts
```

En `src/scripts/seed-demo.ts`:

1. Reemplazar el bloque de imports de `@medusajs/medusa/core-flows` por solo lo que sigue usando la demo:
```ts
import {
  createCustomerAccountWorkflow,
  createInventoryLevelsWorkflow,
} from "@medusajs/medusa/core-flows"
```
y agregar:
```ts
import { readFileSync } from "fs"
import path from "path"
import { TenantConfigSchema } from "../tenant/config-schema"
import { runTenantApply } from "../tenant/run-apply"
```
Borrar la constante `MANUAL_FULFILLMENT_PROVIDER` y la función `safeLink` (ya viven en `src/tenant/`).

2. Renombrar la función: `export default async function seed(` → `export default async function seedDemo(`.

3. Borrar las declaraciones de módulos que ya no se usan: `link`, `storeModule`, `salesChannelModule`, `regionModule`, `taxModule`, `fulfillmentModule`, `apiKeyModule`. Mantener `logger`, `query`, `brandService`, `categoryService`, `customerBrandService`, `stockLocationModule`, `authModule`, `customerModule`.

4. Reemplazar **todo** desde el comentario `// 0. Commerce fundamentals (region, channel, fulfillment, key)` (incluido su bloque `// ====` superior) **hasta justo antes** del comentario `// 2. Create Categories` (incluido su bloque `// ====` superior) por:

```ts
  // ============================================================
  // 0-1. Tenant: valores iniciales + marcas desde tenants/demo.json
  // ============================================================
  const demoConfig = TenantConfigSchema.parse(
    JSON.parse(readFileSync(path.resolve(process.cwd(), "tenants/demo.json"), "utf8"))
  )
  const applyResult = await runTenantApply(container, demoConfig)
  logger.info(`Tenant demo aplicado (bootstrapped: ${applyResult.bootstrapped})`)

  const brands: Record<string, any> = {}
  for (const b of demoConfig.brands) {
    brands[b.slug] = await brandService.findBySlug(b.slug)
  }

  const [stockLocation] = await stockLocationModule.listStockLocations({
    name: demoConfig.initial.stock_location.name,
  })
  if (!stockLocation) {
    throw new Error(`No existe la stock location "${demoConfig.initial.stock_location.name}"`)
  }

```

5. En la sección `// 4. Make products purchasable: sales channel + inventory`, borrar desde `// Linkear cada producto al sales channel de SU marca` hasta el final del bloque `// Revoke any legacy publishable key ...` (el `for` que llama `apiKeyModule.revoke`), inclusive. Debe quedar solo el bloque de inventory levels (`const { data: inventoryItems } = ...` hasta `createInventoryLevelsWorkflow`). `createProductWithBrandWorkflow` ya liga cada producto al canal de su marca.

6. En el `// Summary` final, reemplazar:
```ts
  logger.info(`  - Region: México (MXN, cards + OXXO)`)
  for (const [slug, bc] of Object.entries(brandChannels)) {
    logger.info(`  - Publishable key [${BRAND_CHANNELS[slug]}]: ${bc.keyToken}`)
  }
```
por:
```ts
  logger.info(`  - Region: ${demoConfig.initial.region.name} (${demoConfig.initial.currency.toUpperCase()})`)
  for (const b of applyResult.brands) {
    logger.info(`  - Publishable key [${b.slug}]: ${b.publishable_key}`)
  }
```

7. Cambiar el log inicial `logger.info("Starting seed process...")` por `logger.info("Starting demo seed...")`.

En `package.json`, cambiar el script `seed`:
```json
    "seed": "medusa exec ./src/scripts/seed-demo.ts",
```

Run: `npx tsc --noEmit -p .` → Expected: 0 errores. Si reporta variables sin usar o referencias a `brandChannels`/`BRAND_CHANNELS`/`region`/`defaultSalesChannel`, son restos de las secciones borradas: elimínalos.

Run: `grep -nE "Urban Street|Classic Threads|BRAND_CHANNELS|KEY_TITLES|revoke" src/scripts/seed-demo.ts src/scripts/verify-brand-channels.ts`
Expected: solo menciones dentro de `productsData`/`testCustomers` de la demo (emails `@urban-street.mx`/`@classic-threads.mx`, `brands["urban-street"]`), ninguna de `BRAND_CHANNELS`, `KEY_TITLES` ni `revoke`.

- [ ] **Step 3: Seed sobre DB desechable (instalación nueva)**

Recrear la DB desechable y correr el seed dos veces:
```bash
DATABASE_URL="$SCRATCH_DB_URL" pnpm run seed 2>&1 | grep -E "Tenant demo|Publishable key|rror" | head
DATABASE_URL="$SCRATCH_DB_URL" pnpm run seed 2>&1 | grep -E "Tenant demo|rror" | head
DATABASE_URL="$SCRATCH_DB_URL" npx medusa exec ./src/scripts/verify-brand-channels.ts 2>&1 | grep -E "\[verify\]" | tail -3
```
Expected: primera corrida `bootstrapped: true` y dos keys `pk_...`; segunda `bootstrapped: false`; probe `Todas las invariantes de tenancy se cumplen.`

- [ ] **Step 4: Seed sobre la DB de desarrollo (adopción)**

```bash
DATABASE_URL="$DEV_DB_URL" pnpm run seed 2>&1 | grep -E "Tenant demo|rror" | head
bash /tmp/dev-counts.sh > /tmp/dev-counts-after.txt
diff /tmp/dev-counts-before.txt /tmp/dev-counts-after.txt && echo "SIN CAMBIOS"
DATABASE_URL="$DEV_DB_URL" npx medusa exec ./src/scripts/verify-brand-channels.ts 2>&1 | grep -E "\[verify\]" | tail -5
```
Expected: `bootstrapped: true` (la DB vieja no tenía marcador), `SIN CAMBIOS` en los conteos, y el probe pasa.

Si el probe reporta `producto "..." en N canal(es)` en la DB de desarrollo, son productos de pruebas manuales anteriores: reporta los nombres en vez de borrarlos y sigue (el seed viejo los relinkeaba; ver Step 2.5).

- [ ] **Step 5: Commit**

```bash
git add src/scripts/seed-demo.ts package.json
git commit -m "refactor: seed de demo como un tenant mas sobre tenant apply"
```

---

### Task 7: Documentación y regresión final

**Files:**
- Modify: `README.md`
- Modify: `PENDIENTES.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: documentación del alta de tenant y del estado.

- [ ] **Step 1: README — sección "Alta de un tenant"**

En `README.md`, agregar después de la sección de instalación:

````markdown
## Alta de un tenant

Cada tenant (un negocio, con una o varias marcas) es una instancia de Medusa con su propia DB. La config del tenant la empuja el control plane; en local se aplica desde un archivo.

```bash
# 1. DB vacía + migraciones
pnpm run db:migrate
# 2. Config del tenant (región, almacén, envíos iniciales y marcas)
pnpm run tenant:apply tenants/demo.json
# 3. Usuario admin
npx medusa user -e admin@acme.mx -p <password>
```

- Formato de la config: ver `tenants/demo.json` y `src/tenant/config-schema.ts`.
- `initial` (región, impuestos, almacén, envíos) se aplica **una sola vez**; después se gestiona en el admin de Medusa.
- `brands` se sincroniza en cada apply: crea marca + sales channel + publishable key; las marcas que salen de la config se desactivan (nunca se borran).
- La apariencia de cada marca (logo, colores, descripción) la edita el cliente en el admin de Medusa; nombre, slug y estado solo desde el control plane.
- El control plane usa `POST /internal/tenant/apply` con `Authorization: Bearer $CONTROL_PLANE_TOKEN`. Sin `CONTROL_PLANE_TOKEN` en el `.env`, el endpoint no existe.
- Datos de demo (Urban Street + Classic Threads, productos, clientes de prueba): `pnpm run seed`.
````

Agregar `CONTROL_PLANE_TOKEN=` a `.env.example` si el archivo existe, con el comentario `# Token del control plane para POST /internal/tenant/apply (vacío = endpoint deshabilitado)`.

- [ ] **Step 2: PENDIENTES**

En `PENDIENTES.md`, en la tabla "✅ Resuelto", agregar arriba de la primera fila una fila **"Medusa provisionable por tenant"** que resuma: `applyTenantConfigWorkflow` (valores iniciales una vez + sync de marcas), `POST /internal/tenant/apply` + CLI `tenant:apply`, lock Redis, marcas de solo lectura salvo apariencia, `seed-demo.ts` sobre `tenants/demo.json`, probe sin nombres a mano, y los resultados de verificación de las Tasks 2-6 (escenarios, curl, adopción `SIN CAMBIOS`).

En "🔴 Pendientes", agregar una sección **"3. Tenancy (sub-proyectos 2-4)"** con:
- Control plane (app nueva) + admin de tenants; mostrar `initial` como "solo al crear el tenant".
- Provisioner: crear DB, `db:migrate`, contenedor, Traefik, `medusa user`, `CONTROL_PLANE_TOKEN` por tenant, llamada a `apply`.
- Operación de la flota: migraciones en todos los tenants, suspender/borrar.
- Clientes compartidos entre marcas de un tenant (`customer_brand` N:M).

Borrar del `PENDIENTES.md` la mención de `BRAND_CHANNELS`/`KEY_TITLES` duplicados entre `seed.ts` y el probe si aparece.

- [ ] **Step 3: Regresión final**

```bash
npx tsc --noEmit -p .
pnpm run build 2>&1 | grep -E "completed|rror"
```
Expected: 0 errores; backend y frontend `completed successfully`.

Catálogo por marca sobre la DB de desarrollo. Las keys salen del resultado de `tenant:apply` (idempotente):
```bash
DATABASE_URL="$DEV_DB_URL" pnpm run tenant:apply tenants/demo.json 2>&1 | grep -oE '"slug": "[^"]+"|"publishable_key": "pk_[^"]+"'
```
Levantar el servidor sobre la DB de desarrollo y, por cada marca (reemplaza `<pk>` por su key):
```bash
curl -s "localhost:9100/store/products?limit=50&fields=id,title" -H "x-publishable-api-key: <pk>" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('count'), [p['title'] for p in d['products']])"
```
Expected: cada marca ve solo sus productos (3 por marca en la demo).

Correr el smoke de checkout de `PENDIENTES.md` ("Smoke test del checkout (provider manual)") con la key de `urban-street` → Expected: `"type": "order"`.

- [ ] **Step 4: Commit**

```bash
git add README.md PENDIENTES.md .env.example 2>/dev/null; git add README.md PENDIENTES.md
git commit -m "docs: documentar alta de tenant y estado de la tenancy"
```
