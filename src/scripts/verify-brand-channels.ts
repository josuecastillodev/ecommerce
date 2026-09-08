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
