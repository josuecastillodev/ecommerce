/**
 * Product Brand Validator Subscriber
 * Ensures products are always linked to a brand
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function productBrandValidatorHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const productId = event.data.id

  // Check if product has a brand linked
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "brand.id", "brand.name"],
    filters: { id: productId },
  })

  if (products.length === 0) {
    logger.warn(`Product ${productId} not found during brand validation`)
    return
  }

  const product = products[0] as any

  if (!product.brand?.id) {
    logger.warn(
      `Product "${product.title}" (${productId}) is not linked to any brand. ` +
      `This may cause issues with multi-brand filtering.`
    )
  } else {
    logger.info(
      `Product "${product.title}" is linked to brand "${product.brand.name}"`
    )
  }
}

export const config: SubscriberConfig = {
  event: "product.created",
}
