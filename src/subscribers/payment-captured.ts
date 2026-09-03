import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function paymentCapturedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  logger.info(`Payment captured: ${event.data.id}`)

  // Add custom logic here, e.g.:
  // - Notify the customer that the payment was confirmed
  // - Trigger the fulfillment workflow
}

export const config: SubscriberConfig = {
  event: "payment.captured",
}
