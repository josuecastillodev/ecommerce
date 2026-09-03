import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function paymentRefundedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  logger.info(`Payment refunded: ${event.data.id}`)

  // Add custom logic here, e.g.:
  // - Notify the customer that the refund was processed
  // - Restock the returned items
}

export const config: SubscriberConfig = {
  event: "payment.refunded",
}
