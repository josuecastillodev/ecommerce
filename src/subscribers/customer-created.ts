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
