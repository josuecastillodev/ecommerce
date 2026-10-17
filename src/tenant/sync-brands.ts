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
              } as { name: string }, // CreateSalesChannelDTO no declara metadata aunque el modelo la persiste
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
