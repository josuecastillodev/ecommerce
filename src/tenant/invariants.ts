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
