import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function brandCreatedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  logger.info(`Brand created with ID: ${event.data.id}`)

  // Add custom logic here, e.g.:
  // - Send notification to admin
  // - Initialize brand-specific settings
  // - Create default categories for the brand
}

export const config: SubscriberConfig = {
  event: "brand.created",
}
