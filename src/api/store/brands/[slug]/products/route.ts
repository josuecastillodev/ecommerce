import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { BRAND_MODULE } from "../../../../../modules/brand"
import type BrandModuleService from "../../../../../modules/brand/service"
import { resolveCallerBrand } from "../../../../../utils/brand-middleware"

// GET /store/brands/:slug/products - Productos de una marca.
// Scopeado: el slug del path DEBE ser la marca del sales channel de la
// publishable key del request. Un storefront solo consulta su propia marca.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { slug } = req.params
  const { offset = 0, limit = 20, category_id } = req.query

  // 1. Resolver la marca del canal de la publishable key.
  const callerBrand = await resolveCallerBrand(req)
  if (!callerBrand) {
    res.status(400).json({ message: "Missing publishable API key context" })
    return
  }

  // 2. El slug pedido debe ser el de la marca del caller.
  if (callerBrand.slug !== slug) {
    res.status(404).json({ message: "Brand not found" })
    return
  }

  // 3. Productos de esa marca (comportamiento previo).
  const brand = await brandService.findBySlug(slug)
  if (!brand || !brand.active) {
    res.status(404).json({ message: "Brand not found" })
    return
  }

  const filters: Record<string, unknown> = { brand: { id: brand.id } }
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
    pagination: { skip: Number(offset), take: Number(limit) },
  })

  res.json({
    products,
    count: metadata?.count || products.length,
    offset: Number(offset),
    limit: Number(limit),
    brand,
  })
}
