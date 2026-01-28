import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BRAND_MODULE } from "../../../../modules/brand"
import type BrandModuleService from "../../../../modules/brand/service"

// GET /store/brands/:slug - Get a brand by slug
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)
  const { slug } = req.params

  const brand = await brandService.findBySlug(slug)

  if (!brand || !brand.active) {
    res.status(404).json({ message: "Brand not found" })
    return
  }

  res.json({ brand })
}
