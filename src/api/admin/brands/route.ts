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

// POST /admin/brands - Create a new brand
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)

  const { name, slug, logo_url, primary_color, secondary_color, description, active, metadata } = req.body as {
    name: string
    slug: string
    logo_url?: string
    primary_color?: string
    secondary_color?: string
    description?: string
    active?: boolean
    metadata?: Record<string, unknown>
  }

  const brand = await brandService.createBrands({
    name,
    slug,
    logo_url,
    primary_color,
    secondary_color,
    description,
    active: active ?? true,
    metadata,
  })

  res.status(201).json({ brand })
}
