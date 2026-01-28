import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { BRAND_MODULE } from "../../../../../modules/brand"
import type BrandModuleService from "../../../../../modules/brand/service"

// GET /store/brands/:slug/products - Get products for a brand
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { slug } = req.params
  const { offset = 0, limit = 20, category_id } = req.query

  // First, get the brand by slug
  const brand = await brandService.findBySlug(slug)

  if (!brand || !brand.active) {
    res.status(404).json({ message: "Brand not found" })
    return
  }

  // Query products linked to this brand
  const filters: Record<string, unknown> = {
    brand: { id: brand.id },
  }

  if (category_id) {
    filters.category_id = category_id
  }

  const { data: products, metadata } = await query.graph({
    entity: "product",
    fields: [
      "*",
      "variants.*",
      "variants.prices.*",
      "images.*",
      "categories.*",
      "brand.*",
    ],
    filters,
    pagination: {
      skip: Number(offset),
      take: Number(limit),
    },
  })

  res.json({
    products,
    count: metadata?.count || products.length,
    offset: Number(offset),
    limit: Number(limit),
    brand,
  })
}
