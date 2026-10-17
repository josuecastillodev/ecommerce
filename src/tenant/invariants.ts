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
