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
