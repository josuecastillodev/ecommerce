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
  const created: CreatedBrandResources = { brandIds: [], channelIds: [], keyIds: [] }
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
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const brandService: BrandModuleService = container.resolve(BRAND_MODULE)
  const stockLocationModule = container.resolve(Modules.STOCK_LOCATION)

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
