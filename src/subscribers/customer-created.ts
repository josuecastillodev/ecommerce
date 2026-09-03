import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CUSTOMER_BRAND_MODULE } from "../modules/customer-brand"
import { BRAND_MODULE } from "../modules/brand"
import type BrandModuleService from "../modules/brand/service"
import type CustomerBrandModuleService from "../modules/customer-brand/service"

/**
 * Associates a newly registered customer with a brand.
 *
 * The storefront passes the brand in the customer's `metadata.brand_id` when
 * calling `POST /store/customers`. Registration and password handling stay in
 * Medusa's native flow; this only creates the brand association on top.
 */
export default async function customerCreatedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const customerBrandService: CustomerBrandModuleService = container.resolve(CUSTOMER_BRAND_MODULE)
  const brandService: BrandModuleService = container.resolve(BRAND_MODULE)

  const customerId = event.data.id

  const { data: customers } = await query.graph({
    entity: "customer",
    fields: ["id", "metadata"],
    filters: { id: customerId },
  })

  const customer = customers[0]
  const metadata = (customer?.metadata ?? {}) as Record<string, unknown>
  const brandId = metadata.brand_id as string | undefined

  if (!brandId) {
    logger.warn(
      `Customer ${customerId} was created without metadata.brand_id; no brand association made.`
    )
    return
  }

  const existing = await customerBrandService.findByCustomerId(customerId)
  if (existing) {
    return
  }

  const [brand] = await brandService.listBrands({ id: brandId })
  if (!brand || !brand.active) {
    logger.warn(
      `Customer ${customerId} references brand ${brandId} which does not exist or is inactive; no brand association made.`
    )
    return
  }

  await customerBrandService.associateCustomerWithBrand(customerId, brandId, {
    registered_from: "storefront",
    marketing_consent: metadata.marketing_consent === true,
    language_preference:
      typeof metadata.language_preference === "string"
        ? metadata.language_preference
        : "es",
  })

  logger.info(`Customer ${customerId} associated with brand ${brandId}.`)
}

export const config: SubscriberConfig = {
  event: "customer.created",
}
