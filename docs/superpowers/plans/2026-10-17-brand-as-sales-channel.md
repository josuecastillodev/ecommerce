# Marca = sales channel nativo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la marca sea un sales channel nativo de Medusa (canal default = marca default, datos en `metadata`) y eliminar el módulo `brand`.

**Architecture:** Un helper de solo lectura (`src/brand/channel-brand.ts`) interpreta el sales channel como marca. El apply del tenant sincroniza canales por `metadata.brand_slug` y adopta el canal default. La regla "todo producto en exactamente un canal" se valida en los hooks nativos de producto. Lo que dependía del módulo `brand` se reapunta al canal o se borra; el módulo se elimina al final.

**Tech Stack:** Medusa 2.20.1 (workflows, hooks, Query, admin-sdk widgets), zod 4.2.0, TypeScript, pnpm 10.28.2, Node 24.1.0.

**Spec:** `docs/superpowers/specs/2026-10-17-brand-as-sales-channel-design.md`

## Global Constraints

- Medusa 2.20.1; Node 24.1.0 (`.nvmrc`); pnpm 10.28.2. Instalar dependencias con pnpm (no se agregan dependencias en este plan).
- `pnpm run …` puede fallar en local; usar los equivalentes `npx medusa …`.
- Metadata de marca en el sales channel, claves planas: `brand_slug`, `brand_logo_url`, `brand_primary_color`, `brand_secondary_color`.
- Dueño de `name`, `is_disabled` y `brand_slug`: el control plane. Dueño de `description`, logo y colores: el cliente (se siembran al crear).
- Exactamente una marca con `default: true` en la config; la default no puede ser `active: false`.
- Todo producto está en exactamente un sales channel.
- Commits: `tipo: mensaje corto` en español (feat, fix, refactor, docs, chore), **sin** líneas de crédito ni co-autoría.
- No hay jest: la verificación es `npx medusa build`, `npx tsc --noEmit`, probes con `npx medusa exec` y curl.
- Mensajes de error al usuario en español, como el resto del repo.

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

**Reiniciar la DB de desarrollo** (este plan resiembra el tenant #1; no hay datos que conservar):

```bash
docker exec medusa-postgres psql -U medusa -d postgres \
  -c "drop database if exists ${DEV_DB_URL##*/} with (force)" \
  -c "create database ${DEV_DB_URL##*/}"
DATABASE_URL="$DEV_DB_URL" npx medusa db:migrate
DATABASE_URL="$DEV_DB_URL" npx medusa exec ./src/scripts/seed-demo.ts
DATABASE_URL="$DEV_DB_URL" npx medusa user -e admin@example.com -p supersecret
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

Token de admin y publishable keys para curl:

```bash
export ADMIN_TOKEN=$(curl -s localhost:9100/auth/user/emailpass -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"supersecret"}' | jq -r .token)
# Las pk_ salen al final del log del seed: "Publishable key [urban-street]: pk_..."
export PK_URBAN=pk_...   PK_CLASSIC=pk_...
```

**Nota de orden:** entre la Task 2 y la Task 5 el seed de demo queda roto (todavía lee marcas del módulo `brand`, que el apply ya no crea). No lo corras en ese tramo; las Tasks 3 y 4 se verifican con build y migraciones.

## Review Focus

1. **Formulario nativo sin tocar el canal:** un `POST /admin/products` con `sales_channels: [{ id: <canal default> }]`, que es lo que manda el formulario nativo por defecto, debe crear el producto en la marca default. → Test en Task 5, Step 6.
2. **Producto sin canal por API:** `POST /admin/products` sin `sales_channels` crearía un producto invisible; el hook debe rechazarlo y Medusa revertir la creación. → Test en Task 5, Step 6.
3. **Formulario nativo de editar canal:** manda `name` e `is_disabled` siempre, aunque no cambien. La guarda debe comparar contra el valor actual, no rechazar por presencia; si no, el cliente no puede ni editar la descripción. → Test en Task 8, Step 7.
4. **Cambiar la marca default a otra que ya tiene canal:** el apply debe mover `store.default_sales_channel_id` sin adoptar ni pisar la apariencia del canal default anterior. → Test en Task 2 (escenario 6).
5. **Registro con un canal inválido:** un cliente que se registra con `metadata.sales_channel_id` de un canal inexistente o sin `brand_slug` no debe quedar asociado (warning en el log), y `/store/customers/me` le responde 403. → Test en Task 9, Step 5.

---

### Task 1: Helper de marca sobre el canal y `default` en la config

**Files:**
- Create: `src/brand/channel-brand.ts`
- Create: `src/scripts/check-channel-brand.ts`
- Modify: `src/tenant/config-schema.ts`
- Modify: `tenants/demo.json`

**Interfaces:**
- Consumes: `TenantBrandConfig` de `src/tenant/config-schema.ts`.
- Produces:
  - `BRAND_METADATA_KEYS: { slug: "brand_slug"; logo_url: "brand_logo_url"; primary_color: "brand_primary_color"; secondary_color: "brand_secondary_color" }`
  - `BRAND_CHANNEL_FIELDS: string[]` = `["id", "name", "description", "is_disabled", "metadata"]`
  - `type BrandChannel = { id: string; name: string; description: string | null; is_disabled: boolean; metadata: Record<string, unknown> | null }`
  - `type ChannelBrand = { sales_channel_id: string; slug: string; name: string; description: string | null; active: boolean; logo_url: string | null; primary_color: string; secondary_color: string }`
  - `brandFromChannel(ch: BrandChannel): ChannelBrand | null` (null si no hay `brand_slug` o está vacío)
  - `brandMetadata(cfg: Pick<TenantBrandConfig, "slug" | "logo_url" | "primary_color" | "secondary_color">): Record<string, string>`
  - `TenantBrandConfig` gana `default: boolean`.

- [ ] **Step 1: Escribir el self-check (falla)**

`src/scripts/check-channel-brand.ts`:

```ts
/**
 * Self-check de channel-brand y de las reglas de `default` en la config.
 *   npx medusa exec ./src/scripts/check-channel-brand.ts
 */
import { readFileSync } from "fs"
import path from "path"
import { brandFromChannel, brandMetadata, BRAND_METADATA_KEYS } from "../brand/channel-brand"
import { TenantConfigSchema } from "../tenant/config-schema"

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`[check-channel-brand] FAIL: ${msg}`)
}

export default async function checkChannelBrand() {
  const base = { id: "sc_1", name: "Urban Street", description: "desc", is_disabled: false }

  assert(brandFromChannel({ ...base, metadata: null }) === null, "canal sin metadata no es marca")
  assert(brandFromChannel({ ...base, metadata: { brand_slug: "" } }) === null, "brand_slug vacío no es marca")

  const md = brandMetadata({ slug: "urban-street", logo_url: null, primary_color: "#111111", secondary_color: "#EEEEEE" })
  assert(md[BRAND_METADATA_KEYS.slug] === "urban-street", "brandMetadata escribe el slug")
  const brand = brandFromChannel({ ...base, is_disabled: true, metadata: md })
  assert(brand !== null, "canal con brand_slug es marca")
  assert(brand.sales_channel_id === "sc_1" && brand.slug === "urban-street", "id y slug")
  assert(brand.active === false, "is_disabled se invierte en active")
  assert(brand.logo_url === null, "logo vacío se lee como null")
  assert(brand.primary_color === "#111111" && brand.secondary_color === "#EEEEEE", "colores")
  assert(
    brandFromChannel({ ...base, metadata: { brand_slug: "x" } })!.primary_color === "#000000",
    "color primario por defecto"
  )

  const demo = JSON.parse(readFileSync(path.resolve(process.cwd(), "tenants/demo.json"), "utf8"))
  assert(TenantConfigSchema.safeParse(demo).success, "tenants/demo.json es válido")
  const noDefault = { ...demo, brands: demo.brands.map((b: any) => ({ ...b, default: false })) }
  assert(!TenantConfigSchema.safeParse(noDefault).success, "rechaza config sin marca default")
  const twoDefaults = { ...demo, brands: demo.brands.map((b: any) => ({ ...b, default: true })) }
  assert(!TenantConfigSchema.safeParse(twoDefaults).success, "rechaza dos marcas default")
  const inactiveDefault = {
    ...demo,
    brands: demo.brands.map((b: any) => (b.default ? { ...b, active: false } : b)),
  }
  assert(!TenantConfigSchema.safeParse(inactiveDefault).success, "rechaza marca default inactiva")

  console.log("[check-channel-brand] OK")
}
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `npx medusa exec ./src/scripts/check-channel-brand.ts 2>&1 | grep -E "check-channel-brand|Cannot find|rror" | head`
Expected: FAIL porque no existe `../brand/channel-brand`.

- [ ] **Step 3: Crear `src/brand/channel-brand.ts`**

```ts
/**
 * Marca = sales channel (spec 2026-10-17). La identidad y la apariencia viven
 * en `metadata` con claves planas `brand_*`, editables en el admin nativo.
 * Solo lectura: no toca la DB.
 */
import type { TenantBrandConfig } from "../tenant/config-schema"

export const BRAND_METADATA_KEYS = {
  slug: "brand_slug",
  logo_url: "brand_logo_url",
  primary_color: "brand_primary_color",
  secondary_color: "brand_secondary_color",
} as const

export const BRAND_CHANNEL_FIELDS = ["id", "name", "description", "is_disabled", "metadata"]

export type BrandChannel = {
  id: string
  name: string
  description: string | null
  is_disabled: boolean
  metadata: Record<string, unknown> | null
}

export type ChannelBrand = {
  sales_channel_id: string
  slug: string
  name: string
  description: string | null
  active: boolean
  logo_url: string | null
  primary_color: string
  secondary_color: string
}

const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null)

export function brandFromChannel(ch: BrandChannel): ChannelBrand | null {
  const md = ch.metadata ?? {}
  const slug = str(md[BRAND_METADATA_KEYS.slug])
  if (!slug) return null
  return {
    sales_channel_id: ch.id,
    slug,
    name: ch.name,
    description: ch.description ?? null,
    active: !ch.is_disabled,
    logo_url: str(md[BRAND_METADATA_KEYS.logo_url]),
    primary_color: str(md[BRAND_METADATA_KEYS.primary_color]) ?? "#000000",
    secondary_color: str(md[BRAND_METADATA_KEYS.secondary_color]) ?? "#FFFFFF",
  }
}

export function brandMetadata(
  cfg: Pick<TenantBrandConfig, "slug" | "logo_url" | "primary_color" | "secondary_color">
): Record<string, string> {
  return {
    [BRAND_METADATA_KEYS.slug]: cfg.slug,
    [BRAND_METADATA_KEYS.logo_url]: cfg.logo_url ?? "",
    [BRAND_METADATA_KEYS.primary_color]: cfg.primary_color,
    [BRAND_METADATA_KEYS.secondary_color]: cfg.secondary_color,
  }
}
```

- [ ] **Step 4: Agregar `default` al schema**

En `src/tenant/config-schema.ts`, dentro de `brandSchema`, después de `active`:

```ts
  // Marca default: vive en el canal de store.default_sales_channel_id.
  default: z.boolean().default(false),
```

Y reemplazar el bloque `brands:` de `TenantConfigSchema` por:

```ts
  brands: z
    .array(brandSchema)
    .refine(
      (brands) => new Set(brands.map((b) => b.slug)).size === brands.length,
      "Los slugs de marca deben ser únicos"
    )
    .refine(
      (brands) => brands.filter((b) => b.default).length === 1,
      "Debe haber exactamente una marca con default: true"
    )
    .refine(
      (brands) => brands.every((b) => !b.default || b.active),
      "La marca default no se puede desactivar"
    ),
```

Actualizar el comentario de cabecera del archivo: agregar la línea ` * Una sola marca lleva \`default: true\` (spec 2026-10-17).`

- [ ] **Step 5: Marcar Urban Street como default en la demo**

En `tenants/demo.json`, en la marca `urban-street`, después de `"active": true,` agregar `"default": true,`.

- [ ] **Step 6: Correr el self-check y el typecheck**

Run: `npx medusa exec ./src/scripts/check-channel-brand.ts 2>&1 | grep -E "check-channel-brand" ; npx tsc --noEmit -p . | tail -5`
Expected: `[check-channel-brand] OK` y tsc sin salida.

- [ ] **Step 7: Commit**

```bash
git add src/brand/channel-brand.ts src/scripts/check-channel-brand.ts src/tenant/config-schema.ts tenants/demo.json
git commit -m "feat: helper de marca sobre el sales channel y marca default en la config"
```

---

### Task 2: Apply del tenant e invariantes sobre canales

**Files:**
- Modify: `src/tenant/sync-brands.ts` (reescritura completa)
- Modify: `src/tenant/invariants.ts` (reescritura completa)
- Modify: `src/scripts/verify-tenant-apply.ts` (escenarios)
- Sin cambios: `src/workflows/apply-tenant-config.ts` (sigue llamando `syncBrands`/`undoCreatedBrands` con la misma firma)

**Interfaces:**
- Consumes: `BRAND_CHANNEL_FIELDS`, `BrandChannel`, `brandFromChannel`, `brandMetadata`, `BRAND_METADATA_KEYS` (Task 1); `TenantBrandConfig` con `default`.
- Produces:
  - `syncBrands(container, brands: TenantBrandConfig[]): Promise<{ results: BrandApplyResult[]; created: CreatedBrandResources }>`
  - `type CreatedBrandResources = { channelIds: string[]; keyIds: string[]; adoptedChannel: BrandChannel | null; previousDefaultChannelId: string | null; storeId: string | null }`
  - `undoCreatedBrands(container, created: CreatedBrandResources): Promise<void>`
  - `checkTenancyInvariants(container): Promise<{ oks: string[]; failures: string[] }>` (misma firma)

- [ ] **Step 1: Reescribir los escenarios del probe (falla)**

En `src/scripts/verify-tenant-apply.ts`:

1. Agregar el import: `import { brandFromChannel, BRAND_CHANNEL_FIELDS, type BrandChannel } from "../brand/channel-brand"`.
2. Agregar este helper debajo de `assertInvariants`:

```ts
async function channelBySlug(container: MedusaContainer, slug: string): Promise<BrandChannel | undefined> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "sales_channel", fields: BRAND_CHANNEL_FIELDS })
  return (data as unknown as BrandChannel[]).find((c) => brandFromChannel(c)?.slug === slug)
}
```

3. En la guarda de DB vacía, reemplazar la query de `brands0` y su assert por:

```ts
  const { data: channels0 } = await query.graph({ entity: "sales_channel", fields: BRAND_CHANNEL_FIELDS })
  const branded0 = (channels0 as unknown as BrandChannel[]).filter((c) => brandFromChannel(c))
  assert(!store0?.metadata?.[BOOTSTRAP_MARKER], "la DB ya tiene tenant_bootstrapped_at; usa una DB desechable")
  assert(products0.length === 0 && branded0.length === 0, "la DB tiene productos o marcas; usa una DB desechable")
```

4. Al final del escenario 1, antes del `logger.info`, agregar:

```ts
  const urbanDefault = await channelBySlug(container, demo.brands.find((b) => b.default)!.slug)
  assert(urbanDefault && urbanDefault.id === store1.default_sales_channel_id, "la marca default no adoptó el canal default del store")
  assert(c1.salesChannels === demo.brands.length, `se esperaba un canal por marca (sin canal default suelto): ${c1.salesChannels}`)
```

5. Reemplazar el escenario 3 desde `const brandModule = …` hasta su `logger.info` por:

```ts
  const [urban, classic] = demo.brands
  const extra = { ...urban, slug: "acme-kids", name: "Acme Kids", default: false }
  const s3: TenantConfig = {
    ...demo,
    brands: [{ ...urban, name: "Urban Street MX" }, extra], // classic queda fuera
  }
  const r3 = await runTenantApply(container, s3)
  await assertInvariants(container, "escenario 3")
  const urbanRes = r3.brands.find((b) => b.slug === urban.slug)!
  const urbanChannel = await channelBySlug(container, urban.slug)
  assert(urbanChannel?.name === "Urban Street MX", `canal no renombrado: ${urbanChannel?.name}`)
  assert(r1.brands.find((b) => b.slug === urban.slug)!.sales_channel_id === urbanRes.sales_channel_id, "renombrar creó otro canal")
  const classicChannel = await channelBySlug(container, classic.slug)
  assert(classicChannel && classicChannel.is_disabled === true, "la marca quitada debe quedar con el canal deshabilitado, no borrada")
  logger.info("[verify-tenant-apply] OK escenario 3: agregar, renombrar, quitar")
```

6. Reemplazar el escenario 4 completo por:

```ts
  const oldClassicKey = r1.brands.find((b) => b.slug === classic.slug)!.publishable_key
  const { updateSalesChannelsWorkflow } = await import("@medusajs/medusa/core-flows")
  await updateSalesChannelsWorkflow(container).run({
    input: {
      selector: { id: classicChannel!.id },
      update: { metadata: { ...(classicChannel!.metadata ?? {}), brand_primary_color: "#ABCDEF" } },
    },
  })
  const r4 = await runTenantApply(container, demo)
  await assertInvariants(container, "escenario 4")
  const classicBack = brandFromChannel((await channelBySlug(container, classic.slug))!)!
  const classicRes = r4.brands.find((b) => b.slug === classic.slug)!
  assert(classicBack.active === true, "la marca no se reactivó")
  assert(classicBack.primary_color === "#ABCDEF", "apply pisó la apariencia editada por el cliente")
  assert(classicRes.publishable_key && classicRes.publishable_key !== oldClassicKey, "reactivar debe dar key nueva")
  logger.info("[verify-tenant-apply] OK escenario 4: reactivación conserva apariencia")

  // Escenario 6: mover la marca default a otra que ya tiene canal.
  const urbanBefore = brandFromChannel((await channelBySlug(container, urban.slug))!)!
  const s6: TenantConfig = {
    ...demo,
    brands: demo.brands.map((b) => ({ ...b, default: b.slug === classic.slug })),
  }
  await runTenantApply(container, s6)
  await assertInvariants(container, "escenario 6")
  const [store6] = await storeModule.listStores()
  assert(store6.default_sales_channel_id === classicRes.sales_channel_id, "no se movió store.default_sales_channel_id")
  const urbanAfter = brandFromChannel((await channelBySlug(container, urban.slug))!)!
  assert(urbanAfter.slug === urban.slug && urbanAfter.primary_color === urbanBefore.primary_color, "mover la default tocó el canal anterior")
  await runTenantApply(container, demo)
  const [store6b] = await storeModule.listStores()
  assert(store6b.default_sales_channel_id === urbanAfter.sales_channel_id, "no regresó la default a Urban Street")
  logger.info("[verify-tenant-apply] OK escenario 6: mover la marca default")
```

- [ ] **Step 2: Correrlo y ver que falla**

Prepara la DB desechable (ver "Entorno de verificación").
Run: `DATABASE_URL="$SCRATCH_DB_URL" npx medusa exec ./src/scripts/verify-tenant-apply.ts 2>&1 | grep -E "verify-tenant-apply|rror" | head`
Expected: FAIL en el escenario 1: `la marca default no adoptó el canal default del store`.

- [ ] **Step 3: Reescribir `src/tenant/sync-brands.ts`**

Reemplazar el archivo completo por:

```ts
/**
 * Paso 2 del apply: sincroniza las marcas de la config como sales channels
 * (spec 2026-10-17). `metadata.brand_slug` es la identidad; la marca default
 * vive en el canal de `store.default_sales_channel_id` (se adopta el que creó
 * initial-defaults). Nunca borra marcas: las desactiva (canal deshabilitado,
 * keys revocadas). La apariencia solo se escribe al crear o adoptar el canal;
 * después la edita el cliente en Medusa.
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
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"
import {
  BRAND_CHANNEL_FIELDS,
  BRAND_METADATA_KEYS,
  brandFromChannel,
  brandMetadata,
  type BrandChannel,
} from "../brand/channel-brand"
import type { TenantBrandConfig } from "./config-schema"
import type { BrandApplyResult } from "../workflows/apply-tenant-config"

export type CreatedBrandResources = {
  channelIds: string[]
  keyIds: string[]
  // Estado previo del canal default adoptado, para restaurarlo en rollback.
  adoptedChannel: BrandChannel | null
  previousDefaultChannelId: string | null
  storeId: string | null
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
  const created: CreatedBrandResources = {
    channelIds: [],
    keyIds: [],
    adoptedChannel: null,
    previousDefaultChannelId: null,
    storeId: null,
  }
  try {
    return await syncBrandsInner(container, brands, created)
  } catch (e) {
    // Si el step lanza, Medusa no recibe `created`; deshacer aquí lo ya creado.
    await undoCreatedBrands(container, created)
    throw e
  }
}

async function syncBrandsInner(
  container: MedusaContainer,
  brands: TenantBrandConfig[],
  created: CreatedBrandResources
): Promise<{ results: BrandApplyResult[]; created: CreatedBrandResources }> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const storeModule = container.resolve(Modules.STORE)
  const stockLocationModule = container.resolve(Modules.STOCK_LOCATION)

  const [store] = await storeModule.listStores()
  const defaultChannelId = store?.default_sales_channel_id
  if (!store || !defaultChannelId) {
    throw new Error("La tienda no tiene canal default; los valores iniciales del tenant deben correr antes")
  }
  created.storeId = store.id

  const { data: channelRows } = await query.graph({ entity: "sales_channel", fields: BRAND_CHANNEL_FIELDS })
  const channels = channelRows as unknown as BrandChannel[]
  const bySlug = new Map<string, BrandChannel>()
  for (const ch of channels) {
    const slug = brandFromChannel(ch)?.slug
    if (!slug) continue
    if (bySlug.has(slug)) {
      throw new Error(`Hay dos sales channels con brand_slug "${slug}"; corrígelo antes de aplicar`)
    }
    bySlug.set(slug, ch)
  }

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
  const channelIdBySlug = new Map<string, string>()

  for (const cfg of brands) {
    const existing = bySlug.get(cfg.slug)
    let channelId: string

    // 1. Sales channel (por brand_slug, nunca por nombre).
    if (!existing) {
      const defaultChannel = channels.find((c) => c.id === defaultChannelId)
      if (cfg.default && defaultChannel && !brandFromChannel(defaultChannel)) {
        created.adoptedChannel = { ...defaultChannel }
        await updateSalesChannelsWorkflow(container).run({
          input: {
            selector: { id: defaultChannel.id },
            update: {
              name: cfg.name,
              description: cfg.description,
              is_disabled: !cfg.active,
              metadata: { ...(defaultChannel.metadata ?? {}), ...brandMetadata(cfg) },
            },
          },
        })
        channelId = defaultChannel.id
      } else {
        const { result } = await createSalesChannelsWorkflow(container).run({
          input: {
            salesChannelsData: [
              {
                name: cfg.name,
                description: cfg.description,
                is_disabled: !cfg.active,
                metadata: brandMetadata(cfg),
              },
            ],
          },
        })
        channelId = result[0].id
        created.channelIds.push(channelId)
      }
    } else {
      channelId = existing.id
      if (existing.name !== cfg.name || existing.is_disabled !== !cfg.active) {
        await updateSalesChannelsWorkflow(container).run({
          input: { selector: { id: channelId }, update: { name: cfg.name, is_disabled: !cfg.active } },
        })
      }
    }
    channelIdBySlug.set(cfg.slug, channelId)

    // 2. Canal visible en todos los almacenes del tenant.
    for (const locationId of stockLocationIds) {
      await linkSalesChannelsToStockLocationWorkflow(container).run({
        input: { id: locationId, add: [channelId] },
      })
    }

    // 3. Publishable key.
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

  // 4. La marca default es el canal default del store.
  const defaultSlug = brands.find((b) => b.default)!.slug
  const wantedDefaultId = channelIdBySlug.get(defaultSlug)!
  if (wantedDefaultId !== defaultChannelId) {
    created.previousDefaultChannelId = defaultChannelId
    await updateStoresWorkflow(container).run({
      input: { selector: { id: store.id }, update: { default_sales_channel_id: wantedDefaultId } },
    })
  }

  // 5. Canales de marca que ya no están en la config: desactivar.
  const configSlugs = new Set(brands.map((b) => b.slug))
  for (const [slug, ch] of bySlug) {
    if (configSlugs.has(slug)) continue
    if (!ch.is_disabled) {
      await updateSalesChannelsWorkflow(container).run({
        input: { selector: { id: ch.id }, update: { is_disabled: true } },
      })
    }
    await revokeKeys(liveKeysOf(ch.id).map((k) => k.id))
  }

  return { results, created }
}

/** Compensación del paso 2: deshace lo que este apply creó o adoptó. */
export async function undoCreatedBrands(
  container: MedusaContainer,
  created: CreatedBrandResources
) {
  // Primero el store: Medusa no deja borrar el canal default.
  if (created.previousDefaultChannelId && created.storeId) {
    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: created.storeId },
        update: { default_sales_channel_id: created.previousDefaultChannelId },
      },
    })
  }
  if (created.adoptedChannel) {
    const { id, name, description, is_disabled, metadata } = created.adoptedChannel
    // Vaciar las claves brand_* sirve tanto si Medusa reemplaza la metadata como si la fusiona.
    const clearedBrandKeys = Object.fromEntries(Object.values(BRAND_METADATA_KEYS).map((k) => [k, ""]))
    await updateSalesChannelsWorkflow(container).run({
      input: {
        selector: { id },
        update: { name, description, is_disabled, metadata: { ...(metadata ?? {}), ...clearedBrandKeys } },
      },
    })
  }
  if (created.keyIds.length > 0) {
    await revokeApiKeysWorkflow(container).run({
      input: { selector: { id: created.keyIds }, revoke: { revoked_by: "tenant-apply-rollback" } },
    })
    await deleteApiKeysWorkflow(container).run({ input: { ids: created.keyIds } })
  }
  if (created.channelIds.length > 0) {
    await deleteSalesChannelsWorkflow(container).run({ input: { ids: created.channelIds } })
  }
}
```

- [ ] **Step 4: Reescribir `src/tenant/invariants.ts`**

Reemplazar el archivo completo por:

```ts
/**
 * Invariantes de tenancy multi-marca (marca = sales channel, spec 2026-10-17),
 * sin nombres de marca escritos a mano.
 * Usado por verify-brand-channels.ts y verify-tenant-apply.ts.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { BRAND_CHANNEL_FIELDS, brandFromChannel, type BrandChannel } from "../brand/channel-brand"
import { BOOTSTRAP_MARKER } from "./initial-defaults"

type ChannelRow = BrandChannel & { stock_locations?: { id: string }[] }

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

  const { data: channelRows } = await query.graph({
    entity: "sales_channel",
    fields: [...BRAND_CHANNEL_FIELDS, "stock_locations.id"],
  })
  const channels = channelRows as unknown as ChannelRow[]
  const { data: keys } = await query.graph({
    entity: "api_key",
    fields: ["id", "title", "revoked_at", "sales_channels.id"],
    filters: { type: "publishable" },
  })

  const seenSlugs = new Set<string>()
  for (const ch of channels) {
    const brand = brandFromChannel(ch)
    if (!brand) {
      failures.push(`canal "${ch.name}" sin brand_slug (creado fuera de la config del tenant)`)
      continue
    }
    if (seenSlugs.has(brand.slug)) failures.push(`dos canales con brand_slug "${brand.slug}"`)
    seenSlugs.add(brand.slug)

    const live = (keys as any[]).filter(
      (k) => !k.revoked_at && (k.sales_channels ?? []).some((sc: any) => sc.id === ch.id)
    )
    if (brand.active) {
      if (!(ch.stock_locations ?? []).length) failures.push(`canal de "${brand.slug}" sin almacén`)
      if (live.length !== 1) failures.push(`marca "${brand.slug}" con ${live.length} keys vigentes (se espera 1)`)
      else if ((live[0].sales_channels ?? []).length !== 1)
        failures.push(`key de "${brand.slug}" apunta a ${live[0].sales_channels.length} canales (se espera 1)`)
      else oks.push(`marca activa "${brand.slug}" con canal, almacén y una key`)
    } else {
      if (live.length > 0) failures.push(`marca inactiva "${brand.slug}" con ${live.length} keys vigentes`)
      else oks.push(`marca inactiva "${brand.slug}" sin keys vigentes`)
    }
  }

  const defaultChannel = channels.find((c) => c.id === store?.default_sales_channel_id)
  const defaultBrand = defaultChannel ? brandFromChannel(defaultChannel) : null
  if (!defaultBrand) failures.push("el canal default del store no es una marca")
  else if (!defaultBrand.active) failures.push(`la marca default "${defaultBrand.slug}" está inactiva`)
  else oks.push(`marca default "${defaultBrand.slug}"`)

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "sales_channels.id"],
  })
  for (const p of products as any[]) {
    const n = (p.sales_channels ?? []).length
    if (n !== 1) failures.push(`producto "${p.title}" en ${n} canal(es), se espera exactamente 1`)
  }
  if ((products as any[]).length > 0) oks.push(`${products.length} productos revisados`)

  return { oks, failures }
}
```

- [ ] **Step 5: Correr el probe y ver que pasa**

Recrea la DB desechable (ver "Entorno de verificación"; el Step 2 la dejó con datos).
Run: `DATABASE_URL="$SCRATCH_DB_URL" npx medusa exec ./src/scripts/verify-tenant-apply.ts 2>&1 | grep -E "verify-tenant-apply|rror" | head -20`
Expected: `OK escenario 1`, `2`, `5`, `3`, `4`, `6` y `Todos los escenarios pasan.`

- [ ] **Step 6: Typecheck y commit**

Run: `npx tsc --noEmit -p . | tail -5` → sin salida.

```bash
git add src/tenant/sync-brands.ts src/tenant/invariants.ts src/scripts/verify-tenant-apply.ts
git commit -m "refactor: apply del tenant sincroniza marcas como sales channels"
```

---

### Task 3: Clientes por canal (`customer_brand`)

**Files:**
- Modify: `src/modules/customer-brand/models/customer-brand.ts`
- Create: `src/modules/customer-brand/migrations/Migration<timestamp>.ts` (generada)
- Modify: `src/modules/customer-brand/service.ts`, `types.ts`, `validators.ts`
- Modify: `src/utils/brand-middleware.ts` (`resolveCallerBrand`, `validateCustomerBrand`; borrar `extractBrandId`, `resolveRequestBrandId`, `requireBrandId`, `optionalBrandId`)
- Modify: `src/subscribers/customer-created.ts`
- Modify: `src/api/store/customers/me/brand/route.ts`
- Modify: `src/api/store/categories/route.ts`, `src/api/store/categories/[slug]/products/route.ts`, `src/api/store/brands/[slug]/products/route.ts` (solo el tipo de retorno de `resolveCallerBrand`: `.id` → `.sales_channel_id`)

**Interfaces:**
- Consumes: `BRAND_CHANNEL_FIELDS`, `brandFromChannel`, `ChannelBrand` (Task 1).
- Produces:
  - `resolveCallerBrand(req: MedusaRequest): Promise<ChannelBrand | null>` (marca activa del canal de la publishable key)
  - `CustomerBrandModuleService`: `findByCustomerId(customerId)`, `findByCustomerAndChannel(customerId, salesChannelId)`, `listByChannel(salesChannelId)`, `customerBelongsToChannel(customerId, salesChannelId): Promise<boolean>`, `getCustomerChannelId(customerId): Promise<string | null>`, `associateCustomerWithChannel(customerId, salesChannelId, options?)`, `updateCustomerPreferences(customerId, data)`, `getCustomerCountByChannel(salesChannelId)`
  - Columna `customer_brand.sales_channel_id` (antes `brand_id`).

- [ ] **Step 1: Cambiar el modelo**

En `src/modules/customer-brand/models/customer-brand.ts`: reemplazar `brand_id: model.text(),` por `sales_channel_id: model.text(), // marca = sales channel (spec 2026-10-17)`, y en el comentario de cabecera `with a specific brand` → `with a brand (its sales channel)`.

- [ ] **Step 2: Generar la migración y revisarla**

Run: `DATABASE_URL="$DEV_DB_URL" npx medusa db:generate customerBrandModuleService && ls -t src/modules/customer-brand/migrations | head -2`
Abre la migración nueva. Expected: un `rename column "brand_id" to "sales_channel_id"` o un drop/add de la columna. Cualquiera sirve: no hay tenants en producción y la DB local se resiembra en la Task 5. Si genera algo más que esa columna, detente y revisa el modelo.

- [ ] **Step 3: Reapuntar servicio, tipos y validadores**

En `src/modules/customer-brand/service.ts`, reemplazar los métodos que usan marca por:

```ts
  async findByCustomerAndChannel(customerId: string, salesChannelId: string) {
    const [customerBrand] = await this.listCustomerBrands({
      customer_id: customerId,
      sales_channel_id: salesChannelId,
    })
    return customerBrand || null
  }

  async listByChannel(salesChannelId: string) {
    return this.listCustomerBrands({ sales_channel_id: salesChannelId })
  }

  async customerBelongsToChannel(customerId: string, salesChannelId: string): Promise<boolean> {
    return (await this.findByCustomerAndChannel(customerId, salesChannelId)) !== null
  }

  async getCustomerChannelId(customerId: string): Promise<string | null> {
    const association = await this.findByCustomerId(customerId)
    return association?.sales_channel_id || null
  }

  async associateCustomerWithChannel(
    customerId: string,
    salesChannelId: string,
    options?: {
      registered_from?: "storefront" | "admin" | "api"
      marketing_consent?: boolean
      language_preference?: string
      metadata?: Record<string, unknown>
    }
  ) {
    const existing = await this.findByCustomerId(customerId)
    if (existing) {
      throw new Error(`Customer ${customerId} is already associated with sales channel ${existing.sales_channel_id}`)
    }
    return this.createCustomerBrands({
      customer_id: customerId,
      sales_channel_id: salesChannelId,
      registered_from: options?.registered_from || "storefront",
      marketing_consent: options?.marketing_consent || false,
      language_preference: options?.language_preference || "es",
      metadata: options?.metadata || null,
    })
  }

  async getCustomerCountByChannel(salesChannelId: string): Promise<number> {
    return (await this.listByChannel(salesChannelId)).length
  }
```

(Se conservan `findByCustomerId` y `updateCustomerPreferences` tal cual. Se borran `findByCustomerAndBrand`, `listByBrand`, `customerBelongsToBrand`, `getCustomerBrandId`, `associateCustomerWithBrand` y `getCustomerCountByBrand`.)

En `src/modules/customer-brand/types.ts` y `validators.ts`: renombrar todo `brand_id` a `sales_channel_id` (`sed -i '' 's/brand_id/sales_channel_id/g' src/modules/customer-brand/types.ts src/modules/customer-brand/validators.ts`). En `validators.ts`, el mensaje `"El brand_id es requerido"` queda `"El sales_channel_id es requerido"`. Los campos `brand_name`/`brand_slug`/`brand: {…}` de `types.ts` se quedan: describen la marca, no su id.

- [ ] **Step 4: `resolveCallerBrand` y `validateCustomerBrand` sobre el canal**

En `src/utils/brand-middleware.ts`:

1. Reemplazar los imports de las líneas 1-6 por:

```ts
import { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CUSTOMER_BRAND_MODULE } from "../modules/customer-brand"
import type CustomerBrandModuleService from "../modules/customer-brand/service"
import { BRAND_CHANNEL_FIELDS, brandFromChannel, type BrandChannel, type ChannelBrand } from "../brand/channel-brand"
```

(Si `BRAND_MODULE`/`BrandModuleService` siguen usados en `resolveVariantBrandInfo`, déjalos hasta la Task 6; aquí solo se quita lo que deja de usarse.)

2. Borrar `extractBrandId`, `resolveRequestBrandId`, `requireBrandId` y `optionalBrandId`.

3. Reemplazar `resolveCallerBrand` por:

```ts
/**
 * Marca del caller: la del sales channel de la publishable key del request
 * (`req.publishable_key_context.sales_channel_ids`). `null` si no hay contexto
 * de key o si el canal no es una marca activa. No se puede falsificar desde el
 * cliente: sale de la key, no de un header.
 */
export async function resolveCallerBrand(req: MedusaRequest): Promise<ChannelBrand | null> {
  const channelIds: string[] = (req as any).publishable_key_context?.sales_channel_ids ?? []
  if (channelIds.length === 0) {
    return null
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: BRAND_CHANNEL_FIELDS,
    filters: { id: channelIds },
  })

  return (
    (channels as unknown as BrandChannel[])
      .map(brandFromChannel)
      .find((b): b is ChannelBrand => b !== null && b.active) ?? null
  )
}
```

4. En `validateCustomerBrand`, reemplazar desde `const brandId = await resolveRequestBrandId(req)` hasta el `customerBelongsToBrand(...)` por:

```ts
    const callerBrand = await resolveCallerBrand(req)

    if (!callerBrand) {
      return res.status(400).json({
        type: "invalid_request",
        message: "Se requiere una publishable key vinculada a una marca.",
      })
    }

    const customerBrandService: CustomerBrandModuleService = req.scope.resolve(CUSTOMER_BRAND_MODULE)

    try {
      const belongsToBrand = await customerBrandService.customerBelongsToChannel(
        customerId,
        callerBrand.sales_channel_id
      )
```

(El resto del cuerpo, el 403 y el 500, no cambia.) Actualizar el comentario de cabecera de la función: "Valida que el cliente autenticado pertenezca a la marca (sales channel) de la publishable key."

5. En `src/api/store/categories/route.ts`, `src/api/store/categories/[slug]/products/route.ts` y `src/api/store/brands/[slug]/products/route.ts`, donde se lee `callerBrand.id`, cambiar a `callerBrand.sales_channel_id`. (Los filtros que aún usan esa variable como `brand_id` se corrigen en las Tasks 4 y 7; aquí solo se mantiene la compilación.)

- [ ] **Step 5: Subscriber `customer-created` por canal**

Reemplazar `src/subscribers/customer-created.ts` por:

```ts
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CUSTOMER_BRAND_MODULE } from "../modules/customer-brand"
import type CustomerBrandModuleService from "../modules/customer-brand/service"
import { BRAND_CHANNEL_FIELDS, brandFromChannel, type BrandChannel } from "../brand/channel-brand"

/**
 * Asocia al cliente recién registrado con su marca (sales channel).
 *
 * El storefront manda el canal en `metadata.sales_channel_id` al llamar
 * `POST /store/customers`. El registro y la contraseña siguen en el flujo
 * nativo de Medusa; esto solo crea la asociación encima.
 */
export default async function customerCreatedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const customerBrandService: CustomerBrandModuleService = container.resolve(CUSTOMER_BRAND_MODULE)

  const customerId = event.data.id

  const { data: customers } = await query.graph({
    entity: "customer",
    fields: ["id", "metadata"],
    filters: { id: customerId },
  })

  const metadata = (customers[0]?.metadata ?? {}) as Record<string, unknown>
  const salesChannelId = metadata.sales_channel_id as string | undefined

  if (!salesChannelId) {
    logger.warn(
      `Customer ${customerId} was created without metadata.sales_channel_id; no brand association made.`
    )
    return
  }

  if (await customerBrandService.findByCustomerId(customerId)) {
    return
  }

  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: BRAND_CHANNEL_FIELDS,
    filters: { id: salesChannelId },
  })
  const brand = channels[0] ? brandFromChannel(channels[0] as unknown as BrandChannel) : null
  if (!brand || !brand.active) {
    logger.warn(
      `Customer ${customerId} references sales channel ${salesChannelId}, which is not an active brand; no brand association made.`
    )
    return
  }

  await customerBrandService.associateCustomerWithChannel(customerId, salesChannelId, {
    registered_from: "storefront",
    marketing_consent: metadata.marketing_consent === true,
    language_preference:
      typeof metadata.language_preference === "string" ? metadata.language_preference : "es",
  })

  logger.info(`Customer ${customerId} associated with brand ${brand.slug} (${salesChannelId}).`)
}

export const config: SubscriberConfig = {
  event: "customer.created",
}
```

- [ ] **Step 6: `/store/customers/me/brand` desde el canal**

En `src/api/store/customers/me/brand/route.ts`:

1. Reemplazar los imports de `BRAND_MODULE` y `BrandModuleService` por:
   `import { ContainerRegistrationKeys } from "@medusajs/framework/utils"` y
   `import { BRAND_CHANNEL_FIELDS, brandFromChannel, type BrandChannel } from "../../../../../brand/channel-brand"`.
2. En `GET`, borrar `const brandService … = req.scope.resolve(BRAND_MODULE)` y reemplazar desde `const [brand] = await brandService.listBrands(...)` hasta el cierre de `brand: …` por:

```ts
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: BRAND_CHANNEL_FIELDS,
    filters: { id: customerBrand.sales_channel_id },
  })
  const brand = channels[0] ? brandFromChannel(channels[0] as unknown as BrandChannel) : null

  res.json({
    brand: brand
      ? {
          sales_channel_id: brand.sales_channel_id,
          name: brand.name,
          slug: brand.slug,
          logo_url: brand.logo_url,
          primary_color: brand.primary_color,
        }
      : null,
```

(El bloque `preferences` y el `POST` no cambian.)

- [ ] **Step 7: Aplicar la migración, build y typecheck**

Run: `DATABASE_URL="$DEV_DB_URL" npx medusa db:migrate 2>&1 | tail -3; npx medusa build 2>&1 | tail -3; npx tsc --noEmit -p . | tail -5`
Expected: migración aplicada, build OK y tsc sin salida. Comprueba también que no quedan referencias: `grep -rn "brand_id\|customerBelongsToBrand\|associateCustomerWithBrand\|resolveRequestBrandId\|extractBrandId" src/modules/customer-brand src/subscribers/customer-created.ts src/api/store/customers src/utils/brand-middleware.ts` → sin resultados.

- [ ] **Step 8: Commit**

```bash
git add src/modules/customer-brand src/utils/brand-middleware.ts src/subscribers/customer-created.ts src/api/store
git commit -m "refactor: asociar clientes a la marca por su sales channel"
```

---

### Task 4: Categorías por canal

**Files:**
- Modify: `src/modules/category/models/category.ts`
- Create: `src/modules/category/migrations/Migration<timestamp>.ts` (generada)
- Modify: `src/modules/category/service.ts`, `types.ts`, `validators.ts`
- Modify: `src/api/admin/categories/route.ts`, `src/api/admin/categories/[id]/route.ts`, `src/api/admin/categories/[id]/move/route.ts`, `src/api/admin/categories/reorder/route.ts`
- Modify: `src/api/store/categories/route.ts`, `src/api/store/categories/[slug]/route.ts`, `src/api/store/categories/[slug]/products/route.ts`
- Delete: `src/links/brand-product-category.ts` (sin uso)

**Interfaces:**
- Consumes: `resolveCallerBrand(req): Promise<ChannelBrand | null>` (Task 3).
- Produces:
  - Columna `category.sales_channel_id` (null = categoría global), índice único `(slug, sales_channel_id)`.
  - `CategoryModuleService`: `findBySlug(slug, salesChannelId?)`, `getRootCategories(salesChannelId?)`, `getCategoryTree(salesChannelId?)`, `getCategoriesForChannel(salesChannelId)`, `getCategoryTreeForChannel(salesChannelId)`, `validateSlugUniqueness(slug, salesChannelId, excludeId?)`, `getNextPosition(parentId, salesChannelId)`.
  - Admin: query/body `sales_channel_id` en vez de `brand_id`.

- [ ] **Step 1: Renombrar en el módulo**

```bash
sed -i '' -e 's/brand_id/sales_channel_id/g' -e 's/brandId/salesChannelId/g' \
  -e 's/getCategoriesForBrand/getCategoriesForChannel/g' -e 's/getCategoryTreeForBrand/getCategoryTreeForChannel/g' \
  src/modules/category/models/category.ts src/modules/category/service.ts \
  src/modules/category/types.ts src/modules/category/validators.ts
```

Después revisa a mano los comentarios y mensajes que quedaron con "brand" y cámbialos a "marca (sales channel)": cabecera del modelo (`optional brand association` → `optional brand (sales channel) association`), `service.ts` (`Find category by slug, optionally filtered by brand`, `Get categories for a brand including global categories`, `Get category tree for a brand (including global)`, `Validate slug uniqueness within brand scope`, y el mensaje `this brand` → `this brand's sales channel`). Corre `grep -n "brand" src/modules/category -r` y deja solo menciones en comentarios que digan "marca".

- [ ] **Step 2: Generar la migración y revisarla**

Run: `DATABASE_URL="$DEV_DB_URL" npx medusa db:generate categoryModuleService && ls -t src/modules/category/migrations | head -2`
Expected: rename (o drop/add) de `brand_id` → `sales_channel_id` y recreación de los índices `(slug, sales_channel_id)` y `(sales_channel_id)`. Nada más.

- [ ] **Step 3: Rutas admin**

```bash
sed -i '' -e 's/brand_id/sales_channel_id/g' -e 's/brandId/salesChannelId/g' \
  src/api/admin/categories/route.ts "src/api/admin/categories/[id]/route.ts" \
  "src/api/admin/categories/[id]/move/route.ts" src/api/admin/categories/reorder/route.ts
```

Revisa el comentario `// Validate slug uniqueness within brand scope` de `src/api/admin/categories/route.ts` → `within the brand's sales channel`.

- [ ] **Step 4: Rutas store**

En `src/api/store/categories/route.ts`: renombrar la variable local `brand_id` a `sales_channel_id` (que ya se asigna desde `callerBrand.sales_channel_id` desde la Task 3), y las llamadas a `getCategoryTreeForChannel(sales_channel_id)`, `getCategoriesForChannel(sales_channel_id)`, `getCategoryTree(sales_channel_id)` y `listCategories({ sales_channel_id, is_active: true }, …)`. Actualizar el comentario: "la marca se deriva del sales channel de la publishable key; un `sales_channel_id` del query string se ignora".

En `src/api/store/categories/[slug]/route.ts`: dejar de leer `brand_id` del query string (cualquier storefront podía pedir categorías de otra marca) y usar el canal de la key:

```ts
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CATEGORY_MODULE } from "../../../../modules/category"
import type CategoryModuleService from "../../../../modules/category/service"
import { resolveCallerBrand } from "../../../../utils/brand-middleware"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const categoryService: CategoryModuleService = req.scope.resolve(CATEGORY_MODULE)
  const { slug } = req.params

  const callerBrand = await resolveCallerBrand(req)
  if (!callerBrand) {
    res.status(400).json({ message: "Missing publishable API key context" })
    return
  }

  // Primero la categoría de la marca; si no, la global.
  let category = await categoryService.findBySlug(slug, callerBrand.sales_channel_id)
  if (!category) {
    category = await categoryService.findBySlug(slug, null)
  }
```

(El resto del handler, desde `if (!category || !category.is_active)`, no cambia.)

En `src/api/store/categories/[slug]/products/route.ts`: renombrar `brand_id` a `sales_channel_id`, quitar el `as string` de `findBySlug(slug, sales_channel_id)`, y en `filters` reemplazar `brand: { id: brand_id }` por `sales_channels: { id: sales_channel_id }`. En `fields`, quitar `"brand.*"`.

- [ ] **Step 5: Borrar el link sin uso**

```bash
git rm src/links/brand-product-category.ts
```

- [ ] **Step 6: Migrar, build y typecheck**

Run: `DATABASE_URL="$DEV_DB_URL" npx medusa db:migrate 2>&1 | tail -3; npx medusa build 2>&1 | tail -3; npx tsc --noEmit -p . | tail -5; grep -rn "brand_id" src/modules/category src/api/admin/categories src/api/store/categories`
Expected: migración aplicada, build OK, tsc sin salida, grep vacío.

- [ ] **Step 7: Commit**

```bash
git add -A src/modules/category src/api/admin/categories src/api/store/categories src/links
git commit -m "refactor: categorias por sales channel en vez de marca"
```

---

### Task 5: Producto en exactamente un canal y seed sobre canales

**Files:**
- Create: `src/brand/product-channel-rule.ts`
- Create: `src/workflows/hooks/product-single-channel.ts`
- Create: `src/workflows/create-apparel-product.ts`
- Delete: `src/workflows/hooks/products-created.ts`, `src/workflows/create-product-with-brand.ts`, `src/workflows/add-variant-to-product.ts`
- Delete: `src/api/admin/brand-products/**`, `src/admin/routes/brand-products/**`, `src/admin/widgets/low-stock-alert.tsx`
- Modify: `src/modules/product-extension/types.ts` (input del workflow; quitar `brand_id` de `AddVariantInput`, `SKUGenerationInput`, `ProductQueryFilters`)
- Modify: `src/modules/product-extension/validators.ts` (si referencia `brand_id`)
- Modify: `src/utils/brand-middleware.ts` (borrar `requireProductBrand`, `rejectUnbrandedProductCreate`)
- Modify: `src/api/middlewares.ts` (quitar rutas `/admin/brand-products*` y `/admin/products*` con sus schemas; agregar guarda de `/admin/sales-channels/:id/products`)
- Modify: `src/scripts/seed-demo.ts`
- Modify: `src/admin/lib/api.ts` (borrar `fetchProducts`, `fetchLowStockProducts`), `src/admin/lib/types.ts` (borrar `BrandProduct*`)

**Interfaces:**
- Consumes: `ChannelBrand` y la respuesta del apply (`applyResult.brands[].sales_channel_id`); `CategoryModuleService.findBySlug(slug, salesChannelId)` (Task 4); `CustomerBrandModuleService.associateCustomerWithChannel` (Task 3).
- Produces:
  - `findProductsNotInOneChannel(container, productIds: string[]): Promise<{ id: string; title: string; channels: number }[]>`
  - `assertProductsInOneChannel(container, productIds: string[]): Promise<void>` (lanza `MedusaError.INVALID_DATA`)
  - `guardSalesChannelProducts()` middleware para `POST /admin/sales-channels/:id/products`
  - `createApparelProductWorkflow` con input `CreateApparelProductInput = { sales_channel_id: string; sku_prefix: string; title; …resto igual que el input anterior }`

- [ ] **Step 1: La regla, compartida por hooks y middleware**

`src/brand/product-channel-rule.ts`:

```ts
/**
 * Regla de marca para productos (spec 2026-10-17): todo producto está en
 * exactamente un sales channel, que es su marca.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

export async function findProductsNotInOneChannel(
  container: MedusaContainer,
  productIds: string[]
): Promise<{ id: string; title: string; channels: number }[]> {
  if (productIds.length === 0) return []
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "title", "sales_channels.id"],
    filters: { id: productIds },
  })
  return (data as any[])
    .map((p) => ({ id: p.id, title: p.title, channels: (p.sales_channels ?? []).length }))
    .filter((p) => p.channels !== 1)
}

export async function assertProductsInOneChannel(container: MedusaContainer, productIds: string[]) {
  const bad = await findProductsNotInOneChannel(container, productIds)
  if (bad.length === 0) return
  const detail = bad.map((p) => `"${p.title}" (${p.channels} canales)`).join(", ")
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    `Cada producto debe estar en exactamente un canal de venta (su marca): ${detail}.`
  )
}
```

- [ ] **Step 2: Hooks nativos de crear y editar producto**

`src/workflows/hooks/product-single-channel.ts`:

```ts
/**
 * Valida la regla "un producto, un canal" en los hooks nativos. Medusa liga los
 * canales antes de ejecutar estos hooks, y si el hook lanza, revierte la
 * creación o la edición. Cubre el form del admin, POST /admin/products, el
 * batch y la importación CSV.
 */
import { createProductsWorkflow, updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { assertProductsInOneChannel } from "../../brand/product-channel-rule"

createProductsWorkflow.hooks.productsCreated(async ({ products }, { container }) => {
  await assertProductsInOneChannel(container, products.map((p) => p.id))
})

updateProductsWorkflow.hooks.productsUpdated(async ({ products }, { container }) => {
  await assertProductsInOneChannel(container, products.map((p) => p.id))
})
```

Y borrar el hook anterior (Medusa admite un solo handler por hook):

```bash
git rm src/workflows/hooks/products-created.ts
```

- [ ] **Step 3: Guarda de "agregar productos" desde la pantalla del canal**

En `src/utils/brand-middleware.ts`, borrar `requireProductBrand` y `rejectUnbrandedProductCreate` y agregar al final:

```ts
/**
 * POST /admin/sales-channels/:id/products no tiene hook: un producto agregado
 * aquí quedaría en dos marcas, y uno quitado, en ninguna. Para cambiar un
 * producto de marca se edita su canal desde la pantalla del producto.
 */
export function guardSalesChannelProducts() {
  return async (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
    const body = (req.body as any) ?? {}
    const add: string[] = Array.isArray(body.add) ? body.add : []
    const remove: string[] = Array.isArray(body.remove) ? body.remove : []

    if (remove.length > 0) {
      return res.status(400).json({
        type: "invalid_data",
        message: "Un producto no puede quedarse sin marca. Cambia su canal de venta desde la pantalla del producto.",
      })
    }
    if (add.length === 0) {
      return next()
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "product",
      fields: ["id", "title", "sales_channels.id"],
      filters: { id: add },
    })
    const elsewhere = (data as any[]).filter((p) =>
      (p.sales_channels ?? []).some((sc: any) => sc.id !== req.params.id)
    )
    if (elsewhere.length > 0) {
      return res.status(400).json({
        type: "invalid_data",
        message: `Estos productos ya pertenecen a otra marca: ${elsewhere.map((p) => `"${p.title}"`).join(", ")}. Cambia su canal de venta desde la pantalla del producto.`,
      })
    }
    return next()
  }
}
```

- [ ] **Step 4: Workflow del seed sobre canales y borrado de la API de producto propia**

```bash
git mv src/workflows/create-product-with-brand.ts src/workflows/create-apparel-product.ts
git rm src/workflows/add-variant-to-product.ts
git rm -r src/api/admin/brand-products src/admin/routes/brand-products src/admin/widgets/low-stock-alert.tsx
```

En `src/workflows/create-apparel-product.ts`:

1. Cabecera: `Create Apparel Product Workflow — crea un producto de ropa (tallas × colores, SKUs) en el sales channel de su marca. Lo usa el seed de demo.`
2. Borrar los imports de `BRAND_MODULE`, `BrandModuleService` y `linkProductsToSalesChannelWorkflow`; cambiar `CreateProductWithBrandInput` por `CreateApparelProductInput`.
3. Borrar `validateBrandStep`, `linkProductToBrandStep` y `linkProductToBrandSalesChannelStep`.
4. En el workflow (renombrarlo a `createApparelProductWorkflow`, id `"create-apparel-product"`):
   - Quitar `const brandData = validateBrandStep(...)`.
   - En `productData`, el `transform` recibe solo `{ input }` y el SKU usa `SKUService.generateForVariant(input.sku_prefix, productSlug, variant.size, variant.color.name)`.
   - En `medusaProductInput`, agregar `sales_channels: [{ id: input.sales_channel_id }],` y dejar `metadata: input.metadata`.
   - Quitar las llamadas `linkProductToBrandStep(...)` y `linkProductToBrandSalesChannelStep(...)`, y el `productId` que solo las alimentaba.
   - Retornar `new WorkflowResponse(transform({ products }, ({ products }) => products[0]))`.
   - `export default createApparelProductWorkflow`.

En `src/modules/product-extension/types.ts`:
- `CreateProductWithBrandInput` → `CreateApparelProductInput`, con `sales_channel_id: string` y `sku_prefix: string // slug de la marca` en lugar de `brand_id: string`.
- `UpdateProductWithBrandInput` y `AddVariantInput`: borrarlos (sus únicos usuarios se borraron en este step).
- `SKUGenerationInput.brand_slug` → `sku_prefix`; `ProductQueryFilters.brand_id` → `sales_channel_id`.
- Corre `grep -n "brand_id\|CreateProductWithBrandInput\|UpdateProductWithBrandInput\|AddVariantInput" src/modules/product-extension -r` y ajusta `validators.ts` igual (renombrar a `sales_channel_id`, o borrar el schema si solo servía a los tipos borrados).

En `src/admin/lib/api.ts` borrar `fetchProducts` y `fetchLowStockProducts`, y quitar `BrandProductListResponse` del import. En `src/admin/lib/types.ts` borrar `BrandProductVariant`, `BrandProduct` y `BrandProductListResponse`.

- [ ] **Step 5: Middlewares de producto**

En `src/api/middlewares.ts`:
1. Borrar `createProductSchema`, `updateProductSchema`, `addVariantSchema`, `colorSchema`, `variantSchema`, cualquier schema de query de brand-products y el import de `AVAILABLE_SIZES` si queda sin uso.
2. Borrar los 4 bloques `matcher: "/admin/brand-products…"` y los 4 de `/admin/products`, `/admin/products/batch`, `/admin/products/import` y `/admin/products/imports`, con el comentario que los encabeza.
3. En el import de `../utils/brand-middleware`, quitar `requireProductBrand` y `rejectUnbrandedProductCreate` y agregar `guardSalesChannelProducts`.
4. Agregar, donde estaban los bloques de `/admin/products`:

```ts
    // ==================
    // Admin Product Routes (marca = sales channel, spec 2026-10-17)
    // ==================
    // Crear/editar productos usa las rutas nativas; la regla "un producto, un
    // canal" vive en src/workflows/hooks/product-single-channel.ts. Esta ruta
    // nativa no tiene hook, así que se guarda aquí.
    {
      matcher: "/admin/sales-channels/:id/products",
      method: "POST",
      middlewares: [guardSalesChannelProducts()],
    },
```

- [ ] **Step 6: Seed de demo sobre canales**

En `src/scripts/seed-demo.ts`:

1. Imports: borrar `BRAND_MODULE`, `BrandModuleService`, `createProductWithBrandWorkflow` y `CreateProductWithBrandInput`; agregar `import { createApparelProductWorkflow } from "../workflows/create-apparel-product"` y `import type { CreateApparelProductInput } from "../modules/product-extension/types"`. Borrar `const brandService … = container.resolve(BRAND_MODULE)`.
2. Reemplazar el bloque `const brands: Record<string, any> = {}` y su `for` por:

```ts
  // Marca = sales channel: el apply devuelve el canal de cada marca.
  const channelBySlug: Record<string, string> = Object.fromEntries(
    applyResult.brands.map((b) => [b.slug, b.sales_channel_id])
  )
```

3. Reemplazos en el resto del archivo:
   - `sed -i '' -e 's/brand_id: brands\["\([a-z-]*\)"\]\.id/sales_channel_id: channelBySlug["\1"]/g' -e 's/brand_id: null/sales_channel_id: null/g' -e 's/catData\.brand_id/catData.sales_channel_id/g' src/scripts/seed-demo.ts`
   - Los productos (`productsData`) quedan con `sales_channel_id: channelBySlug["…"]`; agrega a cada uno `sku_prefix: "<mismo slug>"` (`"urban-street"` en los 3 primeros, `"classic-threads"` en los 3 últimos). Tipo del arreglo: `CreateApparelProductInput[]`.
   - `const workflow = createProductWithBrandWorkflow(container)` → `createApparelProductWorkflow(container)`.
4. Clientes de prueba: reemplazar `const brand = brands[tc.brand_slug]` por `const salesChannelId = channelBySlug[tc.brand_slug]`; `metadata: { brand_id: brand.id }` → `metadata: { sales_channel_id: salesChannelId }`; `associateCustomerWithBrand(customer.id, brand.id, {…})` → `associateCustomerWithChannel(customer.id, salesChannelId, {…})`.
5. En el resumen, `Object.keys(brands).length` → `applyResult.brands.length`.
6. Corre `grep -n "brand_id\|brands\[\|brandService" src/scripts/seed-demo.ts` → sin resultados.

- [ ] **Step 7: Resembrar y probar la regla**

Reinicia la DB de desarrollo (ver "Entorno de verificación"), levanta el server en 9100 y saca `ADMIN_TOKEN`, `PK_URBAN` y `PK_CLASSIC`.

```bash
DEFAULT_SC=$(curl -s localhost:9100/admin/stores -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.stores[0].default_sales_channel_id')
CLASSIC_SC=$(curl -s "localhost:9100/admin/sales-channels?limit=50" -H "Authorization: Bearer $ADMIN_TOKEN" \
  | jq -r '.sales_channels[] | select(.metadata.brand_slug=="classic-threads") | .id')
PROFILE=$(curl -s localhost:9100/admin/shipping-profiles -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.shipping_profiles[0].id')
mk() { curl -s -o /dev/null -w "%{http_code}\n" localhost:9100/admin/products -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d "$1"; }
BASE='"options":[{"title":"Talla","values":["M"]}],"variants":[{"title":"M","options":{"Talla":"M"},"prices":[{"amount":100,"currency_code":"mxn"}]}],"shipping_profile_id":"'$PROFILE'"'

# Review Focus 1: lo que manda el form nativo por defecto → 200 y en la marca default
mk '{"title":"RF1 default","sales_channels":[{"id":"'$DEFAULT_SC'"}],'"$BASE"'}'
# Review Focus 2: sin canal → 400 y no queda producto
mk '{"title":"RF2 sin canal",'"$BASE"'}'
# Dos canales → 400
mk '{"title":"Dos canales","sales_channels":[{"id":"'$DEFAULT_SC'"},{"id":"'$CLASSIC_SC'"}],'"$BASE"'}'
curl -s "localhost:9100/admin/products?q=RF2&fields=id" -H "Authorization: Bearer $ADMIN_TOKEN" | jq .count
curl -s "localhost:9100/admin/products?q=Dos%20canales&fields=id" -H "Authorization: Bearer $ADMIN_TOKEN" | jq .count

# Agregar un producto de Urban Street al canal de Classic → 400; quitar → 400
P=$(curl -s "localhost:9100/admin/products?q=RF1&fields=id" -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.products[0].id')
curl -s -o /dev/null -w "%{http_code}\n" localhost:9100/admin/sales-channels/$CLASSIC_SC/products \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"add":["'$P'"]}'
curl -s -o /dev/null -w "%{http_code}\n" localhost:9100/admin/sales-channels/$DEFAULT_SC/products \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"remove":["'$P'"]}'
# Mover el producto de marca editándolo → 200
curl -s -o /dev/null -w "%{http_code}\n" localhost:9100/admin/products/$P -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"sales_channels":[{"id":"'$CLASSIC_SC'"}]}'
```

Expected, en orden: `200`, `400`, `400`, `0`, `0`, `400`, `400`, `200`. Luego borra el producto de prueba: `curl -s -X DELETE localhost:9100/admin/products/$P -H "Authorization: Bearer $ADMIN_TOKEN" >/dev/null`.

Run: `npx medusa exec ./src/scripts/verify-brand-channels.ts 2>&1 | grep -E "verify\]" | tail -3` → `Todas las invariantes de tenancy se cumplen.`

- [ ] **Step 8: Build, typecheck y commit**

Run: `npx medusa build 2>&1 | tail -3; npx tsc --noEmit -p . | tail -5` → OK y sin salida.

```bash
git add -A src/brand src/workflows src/api src/admin src/modules/product-extension src/utils/brand-middleware.ts src/scripts/seed-demo.ts
git commit -m "feat: todo producto en exactamente un sales channel con hooks nativos"
```

---

### Task 6: Carrito por canal sin marca propia

**Files:**
- Modify: `src/utils/brand-middleware.ts` (`resolveVariantBrandInfo`, `checkVariantsAgainstChannel`)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `validateCartLineItemBrand()` y `validateCartCreateBrand()` con la misma firma y cableado.

- [ ] **Step 1: Prueba de regresión antes del cambio**

Con el server arriba y la DB sembrada (Task 5):

```bash
VAR_URBAN=$(curl -s "localhost:9100/store/products?limit=1&fields=variants.id" -H "x-publishable-api-key: $PK_URBAN" | jq -r '.products[0].variants[0].id')
VAR_CLASSIC=$(curl -s "localhost:9100/store/products?limit=1&fields=variants.id" -H "x-publishable-api-key: $PK_CLASSIC" | jq -r '.products[0].variants[0].id')
REGION=$(curl -s localhost:9100/store/regions -H "x-publishable-api-key: $PK_URBAN" | jq -r '.regions[0].id')
CART=$(curl -s localhost:9100/store/carts -H "x-publishable-api-key: $PK_URBAN" -H 'Content-Type: application/json' \
  -d '{"region_id":"'$REGION'"}' | jq -r .cart.id)
li() { curl -s -o /dev/null -w "%{http_code}\n" localhost:9100/store/carts/$CART/line-items -H "x-publishable-api-key: $PK_URBAN" \
  -H 'Content-Type: application/json' -d '{"variant_id":"'$1'","quantity":1}'; }
li $VAR_URBAN; li $VAR_CLASSIC
curl -s -o /dev/null -w "%{http_code}\n" localhost:9100/store/carts -H "x-publishable-api-key: $PK_URBAN" -H 'Content-Type: application/json' \
  -d '{"region_id":"'$REGION'","items":[{"variant_id":"'$VAR_URBAN'","quantity":1},{"variant_id":"'$VAR_CLASSIC'","quantity":1}]}'
```

Expected: `200`, `403`, `403`. Anota el resultado: debe seguir igual después del cambio.

- [ ] **Step 2: Quitar la marca propia del carrito**

En `src/utils/brand-middleware.ts`:

1. `type VariantBrandInfo` queda `{ id: string; channelIds: string[] }`.
2. En `resolveVariantBrandInfo`, `fields: ["id", "product.sales_channels.id"]` y el `map` sin `brandId`.
3. En `checkVariantsAgainstChannel`, reemplazar el caso sin canal (el bloque de `const brands = new Set(...)`) por:

```ts
  // Sin canal resuelto: como cada producto vive en un solo canal (su marca),
  // las variantes deben compartir ese canal.
  const channels = new Set(infos.flatMap((i) => i.channelIds))
  if (channels.size > 1) {
    return {
      type: "not_allowed",
      message: "No puedes mezclar productos de varias marcas en un carrito.",
    }
  }
  return null
```

4. Actualizar los docstrings: en `checkVariantsAgainstChannel`, "Sin `channelIds`: las variantes deben compartir un solo sales channel (su marca)"; en `validateCartLineItemBrand`, cambiar "Como cada canal es 1:1 con una marca (link `brand ↔ sales_channel`)" por "Como cada canal es una marca (spec 2026-10-17)".
5. Borrar los imports de `BRAND_MODULE` y `BrandModuleService` si siguen en el archivo.

- [ ] **Step 3: Repetir la prueba**

Reinicia el server (mata el proceso hijo) y repite el Step 1 con un carrito nuevo.
Expected: `200`, `403`, `403`. `grep -n "brand\.\|BRAND_MODULE" src/utils/brand-middleware.ts` → sin resultados.

- [ ] **Step 4: Typecheck y commit**

Run: `npx tsc --noEmit -p . | tail -5` → sin salida.

```bash
git add src/utils/brand-middleware.ts
git commit -m "refactor: guarda de carrito por sales channel sin modulo de marca"
```

---

### Task 7: `GET /store/brand` en lugar de `/store/brands*`

**Files:**
- Create: `src/api/store/brand/route.ts`
- Delete: `src/api/store/brands/**`
- Modify: `src/api/middlewares.ts` (quitar `/store/brands` y `/store/brands/:slug/products`, y sus schemas de query)

**Interfaces:**
- Consumes: `resolveCallerBrand(req): Promise<ChannelBrand | null>` (Task 3).
- Produces: `GET /store/brand` → `{ brand: { sales_channel_id, slug, name, description, logo_url, primary_color, secondary_color } }` o 404.

- [ ] **Step 1: Prueba (falla)**

Run: `curl -s -o /dev/null -w "%{http_code}\n" localhost:9100/store/brand -H "x-publishable-api-key: $PK_URBAN"`
Expected: `404` (la ruta no existe).

- [ ] **Step 2: Crear la ruta**

`src/api/store/brand/route.ts`:

```ts
/**
 * GET /store/brand — la marca del storefront que llama, para pintarse
 * (nombre, logo, colores). La marca es el sales channel de su publishable key;
 * la Store API nativa no expone el canal (spec 2026-10-17).
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resolveCallerBrand } from "../../../utils/brand-middleware"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const brand = await resolveCallerBrand(req)
  if (!brand) {
    res.status(404).json({ message: "Brand not found" })
    return
  }
  const { active: _active, ...publicBrand } = brand
  res.json({ brand: publicBrand })
}
```

- [ ] **Step 3: Borrar `/store/brands*`**

```bash
git rm -r src/api/store/brands
```

En `src/api/middlewares.ts`, borrar los bloques `matcher: "/store/brands"` y `matcher: "/store/brands/:slug/products"`, y los schemas de query que solo usaban ellos (busca con `grep -n "Brands\|brandProducts" src/api/middlewares.ts`).

- [ ] **Step 4: Probar**

Reinicia el server.

```bash
curl -s localhost:9100/store/brand -H "x-publishable-api-key: $PK_URBAN" | jq -c .brand
curl -s localhost:9100/store/brand -H "x-publishable-api-key: $PK_CLASSIC" | jq -r .brand.slug
curl -s -o /dev/null -w "%{http_code}\n" localhost:9100/store/brands -H "x-publishable-api-key: $PK_URBAN"
```

Expected: el JSON de Urban Street con `slug: "urban-street"` y sus colores (sin `active`), luego `classic-threads`, luego `404`.

- [ ] **Step 5: Typecheck y commit**

Run: `npx tsc --noEmit -p . | tail -5` → sin salida.

```bash
git add -A src/api/store src/api/middlewares.ts
git commit -m "feat: GET /store/brand con la marca de la publishable key"
```

---

### Task 8: Admin sobre pantallas nativas de canales

**Files:**
- Create: `src/admin/widgets/brand-appearance.tsx`
- Create: `src/utils/sales-channel-guard.ts`
- Modify: `src/api/admin/dashboard/metrics/route.ts` (reescritura)
- Modify: `src/admin/widgets/dashboard-metrics.tsx`
- Modify: `src/admin/lib/api.ts`, `src/admin/lib/types.ts`
- Modify: `src/api/middlewares.ts` (quitar `/admin/brands*` y sus schemas; agregar guarda de canales)
- Delete: `src/api/admin/brands/**`, `src/admin/routes/brands/**`, `src/admin/hooks/`, `src/admin/providers/`, `src/admin/widgets/brand-selector.tsx`, `product-brand-filter.tsx`, `order-brand-filter.tsx`, `product-brand-info.tsx`

**Interfaces:**
- Consumes: `BRAND_CHANNEL_FIELDS`, `BRAND_METADATA_KEYS`, `brandFromChannel`, `BrandChannel` (Task 1).
- Produces:
  - `GET /admin/dashboard/metrics?sales_channel_id=<opcional>` → `{ metrics: { total_sales_today, total_orders_today, pending_orders, low_stock_products, by_brand: { sales_channel_id, brand_name, brand_color, total_sales, orders_today, orders_pending, products_count, low_stock_count, currency }[] } }`
  - `guardSalesChannelCreate()`, `guardSalesChannelDelete()`, `guardSalesChannelUpdate()`.

- [ ] **Step 1: Métricas agrupadas por canal**

Reemplazar `src/api/admin/dashboard/metrics/route.ts` por:

```ts
/**
 * Admin Dashboard Metrics
 * GET /admin/dashboard/metrics?sales_channel_id=<opcional>
 *
 * Marca = sales channel (spec 2026-10-17):
 *  - products_count / low_stock_count: product.sales_channels + niveles de inventario
 *  - orders_today / orders_pending / total_sales: order.sales_channel_id (nativo y
 *    directo; el guard de carrito impide pedidos con varias marcas)
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BigNumber, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { VARIANT_STOCK_FIELDS, calculateTotalStock } from "../../../../modules/product-extension"
import { BRAND_CHANNEL_FIELDS, brandFromChannel, type BrandChannel } from "../../../../brand/channel-brand"

const LOW_STOCK_THRESHOLD = 10
const PRODUCT_PAGE_SIZE = 200

type BrandBucket = {
  sales_channel_id: string
  brand_name: string
  brand_color: string
  total_sales: BigNumber
  orders_today: number
  orders_pending: number
  products_count: number
  low_stock_count: number
  currency: string
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// Suma monetaria precisa; descarta montos null/NaN de una orden corrupta.
function addAmount(current: BigNumber, amount: unknown): BigNumber {
  const n = Number(amount ?? 0)
  if (!Number.isFinite(n)) {
    return current
  }
  return new BigNumber(current.bigNumber!.plus(n))
}

// Todos los productos, en lotes acotados.
async function fetchAllProducts(query: any, filters: Record<string, unknown> | undefined): Promise<any[]> {
  const all: any[] = []
  let skip = 0
  while (true) {
    const { data } = await query.graph({
      entity: "product",
      fields: ["id", "sales_channels.id", ...VARIANT_STOCK_FIELDS],
      ...(filters ? { filters } : {}),
      pagination: { take: PRODUCT_PAGE_SIZE, skip },
    })
    all.push(...data)
    if (data.length < PRODUCT_PAGE_SIZE) {
      break
    }
    skip += PRODUCT_PAGE_SIZE
  }
  return all
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const channelFilter = (req.query.sales_channel_id as string) || undefined

  const { data: channelRows } = await query.graph({
    entity: "sales_channel",
    fields: BRAND_CHANNEL_FIELDS,
    ...(channelFilter ? { filters: { id: channelFilter } } : {}),
  })

  const buckets = new Map<string, BrandBucket>()
  for (const ch of channelRows as unknown as BrandChannel[]) {
    const brand = brandFromChannel(ch)
    if (!brand) continue
    buckets.set(ch.id, {
      sales_channel_id: ch.id,
      brand_name: brand.name,
      brand_color: brand.primary_color,
      total_sales: new BigNumber(0),
      orders_today: 0,
      orders_pending: 0,
      products_count: 0,
      low_stock_count: 0,
      currency: "mxn",
    })
  }

  const products = await fetchAllProducts(
    query,
    channelFilter ? { sales_channels: { id: channelFilter } } : undefined
  )
  for (const p of products as any[]) {
    const bucket = buckets.get(p.sales_channels?.[0]?.id)
    if (!bucket) continue
    bucket.products_count += 1
    if (calculateTotalStock(p.variants || []) <= LOW_STOCK_THRESHOLD) bucket.low_stock_count += 1
  }

  const orderScope = channelFilter ? { sales_channel_id: channelFilter } : {}
  const { data: todayOrders } = await query.graph({
    entity: "order",
    fields: ["id", "total", "sales_channel_id"],
    filters: { ...orderScope, created_at: { $gte: startOfToday().toISOString() } },
  })
  const { data: pendingOrders } = await query.graph({
    entity: "order",
    fields: ["id", "sales_channel_id"],
    filters: { ...orderScope, status: ["pending", "requires_action"] },
  })

  for (const o of todayOrders as any[]) {
    const bucket = buckets.get(o.sales_channel_id)
    if (!bucket) continue
    bucket.orders_today += 1
    bucket.total_sales = addAmount(bucket.total_sales, o.total)
  }
  for (const o of pendingOrders as any[]) {
    const bucket = buckets.get(o.sales_channel_id)
    if (bucket) bucket.orders_pending += 1
  }

  const by_brand = Array.from(buckets.values())
  res.json({
    metrics: {
      total_sales_today: by_brand.reduce(
        (s, b) => new BigNumber(s.bigNumber!.plus(b.total_sales.bigNumber!)),
        new BigNumber(0)
      ),
      total_orders_today: by_brand.reduce((s, b) => s + b.orders_today, 0),
      pending_orders: by_brand.reduce((s, b) => s + b.orders_pending, 0),
      low_stock_products: by_brand.reduce((s, b) => s + b.low_stock_count, 0),
      by_brand,
    },
  })
}
```

- [ ] **Step 2: Tipos y API del admin**

`src/admin/lib/types.ts` queda:

```ts
/**
 * Admin Types for Multi-Brand Support (marca = sales channel)
 */

export interface BrandStats {
  sales_channel_id: string
  brand_name: string
  brand_color: string
  total_sales: number
  orders_today: number
  orders_pending: number
  products_count: number
  low_stock_count: number
  currency: string
}

export interface DashboardMetrics {
  total_sales_today: number
  total_orders_today: number
  pending_orders: number
  low_stock_products: number
  by_brand: BrandStats[]
}
```

`src/admin/lib/api.ts` queda:

```ts
/**
 * Admin API Functions for Multi-Brand
 */

import type { DashboardMetrics } from "./types"

/**
 * Fetch dashboard metrics
 */
export async function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  const response = await fetch(`/admin/dashboard/metrics`)

  if (!response.ok) {
    throw new Error("Failed to fetch dashboard metrics")
  }

  const data = await response.json()
  return data.metrics
}
```

- [ ] **Step 3: Widget de métricas sin selector de marca**

En `src/admin/widgets/dashboard-metrics.tsx`:
1. Borrar `import { useBrands } from "../hooks/use-brand"` y la línea `const { brands, selectedBrand, isLoading: brandsLoading } = useBrands()`.
2. En el `useEffect`: `fetchDashboardMetrics()` sin argumento, y dependencias `[retryKey]`.
3. `if (brandsLoading || isLoading)` → `if (isLoading)`.
4. Encabezado: `Dashboard` y el subtítulo fijo `"Métricas de todas las marcas"`.
5. Bloque por marca: condición `metrics.by_brand.length > 1`; borrar `const brand = brands.find(...)`; `key={brandMetrics.sales_channel_id}`; color `style={{ backgroundColor: brandMetrics.brand_color }}`.

- [ ] **Step 4: Guarda de canales en rutas nativas**

`src/utils/sales-channel-guard.ts`:

```ts
/**
 * Guarda de los datos de marca que posee el control plane (spec 2026-10-17):
 * desde el admin nativo no se crean ni borran canales, ni se cambia su nombre,
 * su estado o su brand_slug. Descripción, logo y colores sí (los edita el
 * cliente). Compara contra el valor actual, porque el form nativo de editar
 * canal manda `name` e `is_disabled` siempre, aunque no cambien.
 */
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { BRAND_CHANNEL_FIELDS, BRAND_METADATA_KEYS, type BrandChannel } from "../brand/channel-brand"

const OWNED_BY_CONTROL_PLANE =
  "Las marcas (canales de venta) las gestiona el control plane del tenant; aquí solo se edita su apariencia."
const HEX = /^#[0-9A-Fa-f]{6}$/

const reject = (res: MedusaResponse, message: string) =>
  res.status(400).json({ type: "invalid_data", message })

export function guardSalesChannelCreate() {
  return (_req: MedusaRequest, res: MedusaResponse) => reject(res, OWNED_BY_CONTROL_PLANE)
}

export function guardSalesChannelDelete() {
  return (_req: MedusaRequest, res: MedusaResponse) => reject(res, OWNED_BY_CONTROL_PLANE)
}

export function guardSalesChannelUpdate() {
  return async (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
    const body = (req.body as any) ?? {}
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "sales_channel",
      fields: BRAND_CHANNEL_FIELDS,
      filters: { id: req.params.id },
    })
    const current = data[0] as unknown as BrandChannel | undefined
    if (!current) return next() // que el handler nativo responda 404

    if (body.name !== undefined && body.name !== current.name) return reject(res, OWNED_BY_CONTROL_PLANE)
    if (body.is_disabled !== undefined && body.is_disabled !== current.is_disabled)
      return reject(res, OWNED_BY_CONTROL_PLANE)

    if (body.metadata !== undefined) {
      const md = body.metadata ?? {}
      if (md[BRAND_METADATA_KEYS.slug] !== current.metadata?.[BRAND_METADATA_KEYS.slug])
        return reject(res, OWNED_BY_CONTROL_PLANE)
      for (const key of [BRAND_METADATA_KEYS.primary_color, BRAND_METADATA_KEYS.secondary_color]) {
        const v = md[key]
        if (v !== undefined && v !== "" && !(typeof v === "string" && HEX.test(v)))
          return reject(res, `${key} debe ser un color hex #RRGGBB`)
      }
      const logo = md[BRAND_METADATA_KEYS.logo_url]
      if (logo !== undefined && logo !== "" && !(typeof logo === "string" && URL.canParse(logo)))
        return reject(res, `${BRAND_METADATA_KEYS.logo_url} debe ser una URL`)
    }
    return next()
  }
}
```

En `src/api/middlewares.ts`:
1. Borrar `updateBrandAppearanceSchema`, `listBrandsQuerySchema` y los bloques `matcher: "/admin/brands"` y `"/admin/brands/:id"`.
2. Agregar `import { guardSalesChannelCreate, guardSalesChannelDelete, guardSalesChannelUpdate } from "../utils/sales-channel-guard"`.
3. Junto al bloque de `/admin/sales-channels/:id/products` (Task 5), agregar:

```ts
    { matcher: "/admin/sales-channels", method: "POST", middlewares: [guardSalesChannelCreate()] },
    { matcher: "/admin/sales-channels/:id", method: "POST", middlewares: [guardSalesChannelUpdate()] },
    { matcher: "/admin/sales-channels/:id", method: "DELETE", middlewares: [guardSalesChannelDelete()] },
```

- [ ] **Step 5: Widget de apariencia en la pantalla del canal**

`src/admin/widgets/brand-appearance.tsx`:

```tsx
/**
 * Apariencia de la marca en la pantalla nativa del sales channel: descripción,
 * logo y colores. Guarda por la ruta nativa POST /admin/sales-channels/:id; el
 * nombre, el estado y el slug los gestiona el control plane.
 */
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { DetailWidgetProps, AdminSalesChannel } from "@medusajs/framework/types"
import { Button, Container, Heading, Input, Label, Text, Textarea, toast } from "@medusajs/ui"
import { useState } from "react"

const KEYS = {
  slug: "brand_slug",
  logo_url: "brand_logo_url",
  primary_color: "brand_primary_color",
  secondary_color: "brand_secondary_color",
} as const

const BrandAppearanceWidget = ({ data: channel }: DetailWidgetProps<AdminSalesChannel>) => {
  const md = (channel.metadata ?? {}) as Record<string, string>
  const [form, setForm] = useState({
    description: channel.description ?? "",
    logo_url: md[KEYS.logo_url] ?? "",
    primary_color: md[KEYS.primary_color] || "#000000",
    secondary_color: md[KEYS.secondary_color] || "#FFFFFF",
  })
  const [saving, setSaving] = useState(false)

  if (!md[KEYS.slug]) {
    return null
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const save = async () => {
    setSaving(true)
    try {
      const response = await fetch(`/admin/sales-channels/${channel.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: form.description || null,
          metadata: {
            ...md,
            [KEYS.logo_url]: form.logo_url,
            [KEYS.primary_color]: form.primary_color,
            [KEYS.secondary_color]: form.secondary_color,
          },
        }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.message || "No se pudo guardar la apariencia.")
      }
      toast.success("Apariencia guardada")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar la apariencia.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Container className="p-6 space-y-4">
      <div>
        <Heading level="h2">Apariencia de la marca</Heading>
        <Text size="small" className="text-ui-fg-muted">
          Nombre, slug y estado se gestionan desde el control plane del tenant.
        </Text>
      </div>
      <div>
        <Label htmlFor="brand-description">Descripción</Label>
        <Textarea id="brand-description" rows={3} value={form.description} onChange={set("description")} />
      </div>
      <div>
        <Label htmlFor="brand-logo">URL del logo</Label>
        <Input id="brand-logo" type="url" placeholder="https://..." value={form.logo_url} onChange={set("logo_url")} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        {(["primary_color", "secondary_color"] as const).map((key) => (
          <div key={key}>
            <Label htmlFor={`brand-${key}`}>{key === "primary_color" ? "Color primario" : "Color secundario"}</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label={key === "primary_color" ? "Selector de color primario" : "Selector de color secundario"}
                value={form[key]}
                onChange={set(key)}
                className="w-12 h-10 rounded border border-ui-border-base cursor-pointer"
              />
              <Input id={`brand-${key}`} value={form[key]} onChange={set(key)} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button onClick={save} isLoading={saving}>
          Guardar apariencia
        </Button>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "sales_channel.details.after",
})

export default BrandAppearanceWidget
```

- [ ] **Step 6: Borrar el admin de marcas propio**

```bash
git rm -r src/api/admin/brands src/admin/routes/brands src/admin/hooks src/admin/providers
git rm src/admin/widgets/brand-selector.tsx src/admin/widgets/product-brand-filter.tsx \
  src/admin/widgets/order-brand-filter.tsx src/admin/widgets/product-brand-info.tsx
grep -rn "use-brand\|brand-provider\|fetchBrand\|updateBrand\|BRAND_STORAGE_KEY\|BrandContext" src/admin
```

Expected: el grep sin resultados.

- [ ] **Step 7: Probar guarda, métricas y widget**

Reinicia el server y saca `ADMIN_TOKEN`, `DEFAULT_SC` (ver Task 5, Step 7).

```bash
SC_JSON=$(curl -s "localhost:9100/admin/sales-channels/$DEFAULT_SC" -H "Authorization: Bearer $ADMIN_TOKEN" | jq .sales_channel)
NAME=$(echo "$SC_JSON" | jq -r .name); MD=$(echo "$SC_JSON" | jq -c .metadata)
up() { curl -s -o /dev/null -w "%{http_code}\n" "localhost:9100/admin/sales-channels/$DEFAULT_SC" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "$1"; }
# Review Focus 3: el form nativo manda name e is_disabled sin cambios → 200
up '{"name":"'"$NAME"'","is_disabled":false,"description":"Nueva descripción"}'
up '{"name":"Otro nombre"}'                                                  # 400
up '{"is_disabled":true}'                                                    # 400
up '{"metadata":'"$(echo "$MD" | jq -c '.brand_slug="otro"')"'}'             # 400
up '{"metadata":'"$(echo "$MD" | jq -c '.brand_primary_color="rojo"')"'}'    # 400
up '{"metadata":'"$(echo "$MD" | jq -c '.brand_primary_color="#123456"')"'}' # 200
curl -s -o /dev/null -w "%{http_code}\n" localhost:9100/admin/sales-channels -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Canal suelto"}'          # 400
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE "localhost:9100/admin/sales-channels/$DEFAULT_SC" \
  -H "Authorization: Bearer $ADMIN_TOKEN"                                    # 400
curl -s localhost:9100/admin/dashboard/metrics -H "Authorization: Bearer $ADMIN_TOKEN" \
  | jq -c '.metrics.by_brand[] | {brand_name, brand_color, products_count}'
curl -s localhost:9100/store/brand -H "x-publishable-api-key: $PK_URBAN" | jq -r .brand.primary_color
```

Expected: `200`, `400`, `400`, `400`, `400`, `200`, `400`, `400`; dos marcas con 3 productos cada una (Urban Street con `brand_color` `#123456`); y `#123456` en el storefront.

En el navegador (`localhost:9100/app`, admin@example.com / supersecret): Settings → Sales Channels → Urban Street muestra el bloque "Apariencia de la marca"; cambia el color y guarda → toast "Apariencia guardada". Products muestra el widget de métricas sin selector de marca. Usa la skill `claude-in-chrome` o `playwright-cli` si estás automatizando.

- [ ] **Step 8: Build, typecheck y commit**

Run: `npx medusa build 2>&1 | tail -3; npx tsc --noEmit -p . | tail -5` → OK y sin salida.

```bash
git add -A src/admin src/api src/utils/sales-channel-guard.ts
git commit -m "feat: admin de marcas sobre las pantallas nativas de sales channels"
```

---

### Task 9: Borrar el módulo `brand`, documentar y verificar de punta a punta

**Files:**
- Delete: `src/modules/brand/`, `src/links/brand-product.ts`, `src/links/brand-sales-channel.ts`, `src/links/brand-customer.ts`, `src/subscribers/brand-created.ts`
- Modify: `medusa-config.ts` (quitar el módulo brand)
- Modify: `PENDIENTES.md`, `README.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: repo sin módulo `brand`.

- [ ] **Step 1: Borrar el módulo y sus links**

```bash
git rm -r src/modules/brand
git rm src/links/brand-product.ts src/links/brand-sales-channel.ts src/links/brand-customer.ts src/subscribers/brand-created.ts
```

En `medusa-config.ts`, borrar el bloque:

```ts
    // Custom Brand module
    {
      resolve: "./src/modules/brand",
    },
```

- [ ] **Step 2: Nada referencia la marca propia**

Run: `grep -rnE "modules/brand|BRAND_MODULE|brandModuleService|BrandModuleService|\"brand\.|entity: \"brand\"" src medusa-config.ts`
Expected: sin resultados. (Las rutas `src/brand/*` son el helper nuevo, no el módulo.)

Run: `npx medusa build 2>&1 | tail -3; npx tsc --noEmit -p . | tail -5`
Expected: build OK y tsc sin salida.

- [ ] **Step 3: Probes sobre DB nueva**

Recrea la DB desechable y corre:

```bash
DATABASE_URL="$SCRATCH_DB_URL" npx medusa exec ./src/scripts/verify-tenant-apply.ts 2>&1 | grep -E "verify-tenant-apply" | tail -2
DATABASE_URL="$SCRATCH_DB_URL" npx medusa exec ./src/scripts/check-channel-brand.ts 2>&1 | grep check-channel-brand
```

Reinicia la DB de desarrollo (ver "Entorno de verificación": migrate + seed + admin user) y corre:

```bash
npx medusa exec ./src/scripts/verify-brand-channels.ts 2>&1 | grep -E "verify\]" | tail -3
docker exec medusa-postgres psql -U medusa -d "${DEV_DB_URL##*/}" -tc "select to_regclass('public.brand')"
```

Expected: `Todos los escenarios pasan.`, `[check-channel-brand] OK`, `Todas las invariantes de tenancy se cumplen.`, y la tabla `brand` no existe en la DB nueva (vacío).

Después corre el seed dos veces: `npx medusa exec ./src/scripts/seed-demo.ts` → la segunda corrida no crea nada nuevo (logs "already exists") y las invariantes siguen pasando.

- [ ] **Step 4: Regresión con curl**

Levanta el server en 9100 y saca `ADMIN_TOKEN`, `PK_URBAN` y `PK_CLASSIC`.

1. Repite la Task 5 Step 7 (productos), la Task 6 Step 1 (carrito: `200`, `403`, `403`), la Task 7 Step 4 (`/store/brand`) y la Task 8 Step 7 (guarda y métricas), con los mismos resultados esperados.
2. Clientes:

```bash
login() { curl -s localhost:9100/auth/customer/emailpass -H 'Content-Type: application/json' \
  -d '{"email":"'$1'","password":"Password123"}' | jq -r .token; }
ANA=$(login ana@urban-street.mx)
curl -s -o /dev/null -w "%{http_code}\n" localhost:9100/store/customers/me/brand -H "Authorization: Bearer $ANA" -H "x-publishable-api-key: $PK_URBAN"
curl -s -o /dev/null -w "%{http_code}\n" localhost:9100/store/customers/me/brand -H "Authorization: Bearer $ANA" -H "x-publishable-api-key: $PK_CLASSIC"
curl -s localhost:9100/store/customers/me/brand -H "Authorization: Bearer $ANA" -H "x-publishable-api-key: $PK_URBAN" | jq -r .brand.slug
```

Expected: `200`, `403`, `urban-street`.

3. Checkout completo con el provider manual: sigue la sección "Smoke test del checkout (provider manual)" de `PENDIENTES.md` con `$PK_URBAN`. Expected: `{"type":"order", …}`. Comprueba que la orden quedó en el canal: `curl -s "localhost:9100/admin/orders?fields=sales_channel_id&limit=1" -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.orders[0].sales_channel_id'` → el `sales_channel_id` de Urban Street, y `/admin/dashboard/metrics` cuenta 1 en `orders_today` de Urban Street.

- [ ] **Step 5: Registro con canal inválido (Review Focus 5)**

```bash
reg() { # $1 email, $2 sales_channel_id
  T=$(curl -s localhost:9100/auth/customer/emailpass/register -H 'Content-Type: application/json' \
    -d '{"email":"'$1'","password":"Password123"}' | jq -r .token)
  curl -s -o /dev/null localhost:9100/store/customers -H "Authorization: Bearer $T" -H "x-publishable-api-key: $PK_URBAN" \
    -H 'Content-Type: application/json' -d '{"email":"'$1'","metadata":{"sales_channel_id":"'$2'"}}'
  login $1
}
BAD=$(reg rf5-a@example.com sc_no_existe)
curl -s -o /dev/null -w "%{http_code}\n" localhost:9100/store/customers/me -H "Authorization: Bearer $BAD" -H "x-publishable-api-key: $PK_URBAN"
grep -c "not an active brand; no brand association made" /tmp/medusa-dev.log
GOOD=$(reg rf5-b@example.com "$DEFAULT_SC")
curl -s -o /dev/null -w "%{http_code}\n" localhost:9100/store/customers/me -H "Authorization: Bearer $GOOD" -H "x-publishable-api-key: $PK_URBAN"
```

Expected: `403`, `1` (o más), `200`.

- [ ] **Step 6: Documentación**

En `PENDIENTES.md`:
1. Agregar una fila en ✅ Resuelto: **"Marca = sales channel nativo"** — el módulo `brand` y sus links se eliminaron; cada sales channel es una marca (`metadata.brand_*`); el canal default del store es la marca default (`default: true` en la config); todo producto en exactamente un canal (hooks nativos `productsCreated`/`productsUpdated` + guarda de `/admin/sales-channels/:id/products`); el formulario nativo de crear producto vuelve a funcionar; `/store/brands*` → `GET /store/brand`; admin de marcas → widget de apariencia en la pantalla nativa del canal + guarda de nombre/estado/slug; `customer_brand` y `category` usan `sales_channel_id`. Spec y plan: `docs/superpowers/specs|plans/2026-10-17-brand-as-sales-channel*`.
2. En 🔴 Pendientes → Varios: borrar la viñeta de `requireBrandId`/`optionalBrandId` (ya no existen) y la de `default_sales_channel_id` apuntando a un canal huérfano (ahora es la marca default). Cambiar "No hay admin user scopeado por marca: el admin ve todos los canales/marcas" para que diga "canales (marcas)".
3. Agregar a 🔴 Pendientes → Varios:
   - "Fase 2 del principio 'todo nativo': cambiar el módulo `category` por product categories nativas y `product-extension` (SKU, tallas) por variantes/opciones nativas."
   - "`customer-created` confía en el `metadata.sales_channel_id` que manda el storefront al registrar; derivarlo de la publishable key del registro."
   - "Contrato con el control plane: `brands[].default` (exactamente una). Reflejarlo en el sub-proyecto 2."
4. En "Cómo correr y probar en local" y en los smoke tests: cambiar cualquier mención de `X-Brand-Id`, `brand_id` o `/store/brands` por el equivalente actual (publishable key, `sales_channel_id`, `GET /store/brand`).

En `README.md`, sección de API Endpoints: quitar `/admin/brands*`, `/admin/brand-products*`, `/store/brands*`; agregar `GET /store/brand` y una línea: "Las marcas son sales channels; se editan en Settings → Sales Channels (apariencia) y las gestiona el control plane vía `POST /internal/tenant/apply`."

- [ ] **Step 7: Commits**

```bash
git add -A src medusa-config.ts
git commit -m "refactor: eliminar el modulo de marca, la marca es el sales channel"
git add PENDIENTES.md README.md
git commit -m "docs: documentar marca como sales channel nativo"
```
