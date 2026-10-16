import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BRAND_MODULE } from "../../../modules/brand"
import type BrandModuleService from "../../../modules/brand/service"

// GET /admin/brands - List all brands
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)

  const { offset = 0, limit = 20, active, name } = req.query

  const filters: Record<string, unknown> = {}
  if (active !== undefined) {
    filters.active = active === "true"
  }
  if (name) {
    filters.name = name
  }

  const [brands, count] = await brandService.listAndCountBrands(
    filters,
    {
      skip: Number(offset),
      take: Number(limit),
      order: { created_at: "DESC" },
    }
  )

  res.json({
    brands,
    count,
    offset: Number(offset),
    limit: Number(limit),
  })
}

// Las marcas se crean desde el control plane (POST /internal/tenant/apply).
export async function POST(_req: MedusaRequest, res: MedusaResponse) {
  res.status(403).json({
    type: "not_allowed",
    message: "Las marcas se crean desde el control plane del tenant.",
  })
}
