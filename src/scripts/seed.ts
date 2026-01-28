import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { BRAND_MODULE } from "../modules/brand"
import type BrandModuleService from "../modules/brand/service"

export default async function seed({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const brandService: BrandModuleService = container.resolve(BRAND_MODULE)

  logger.info("Seeding brands...")

  // Create sample brands
  const brands = [
    {
      name: "Urban Street",
      slug: "urban-street",
      description: "Streetwear urbano para jóvenes audaces",
      primary_color: "#1A1A1A",
      secondary_color: "#FF4444",
      active: true,
      metadata: {
        target_audience: "18-30",
        style: "streetwear",
      },
    },
    {
      name: "Classic Threads",
      slug: "classic-threads",
      description: "Moda clásica y atemporal para toda ocasión",
      primary_color: "#2C3E50",
      secondary_color: "#ECF0F1",
      active: true,
      metadata: {
        target_audience: "25-45",
        style: "classic",
      },
    },
  ]

  for (const brandData of brands) {
    const existing = await brandService.findBySlug(brandData.slug)

    if (!existing) {
      await brandService.createBrands(brandData)
      logger.info(`Created brand: ${brandData.name}`)
    } else {
      logger.info(`Brand already exists: ${brandData.name}`)
    }
  }

  logger.info("Brands seeded successfully!")
}
