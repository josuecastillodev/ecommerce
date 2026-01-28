import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BRAND_MODULE } from "../../../modules/brand"
import type BrandModuleService from "../../../modules/brand/service"

// GET /store/brands - List all active brands
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)

  const { offset = 0, limit = 20 } = req.query

  const [brands, count] = await brandService.listAndCountBrands(
    { active: true },
    {
      skip: Number(offset),
      take: Number(limit),
      order: { name: "ASC" },
    }
  )

  res.json({
    brands,
    count,
    offset: Number(offset),
    limit: Number(limit),
  })
}
