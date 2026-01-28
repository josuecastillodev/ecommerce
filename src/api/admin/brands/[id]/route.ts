import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BRAND_MODULE } from "../../../../modules/brand"
import type BrandModuleService from "../../../../modules/brand/service"

// GET /admin/brands/:id - Get a single brand
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)
  const { id } = req.params

  const brand = await brandService.retrieveBrand(id)

  if (!brand) {
    res.status(404).json({ message: "Brand not found" })
    return
  }

  res.json({ brand })
}

// POST /admin/brands/:id - Update a brand
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)
  const { id } = req.params

  const { name, slug, logo_url, primary_color, secondary_color, description, active, metadata } = req.body as {
    name?: string
    slug?: string
    logo_url?: string
    primary_color?: string
    secondary_color?: string
    description?: string
    active?: boolean
    metadata?: Record<string, unknown>
  }

  const brand = await brandService.updateBrands({
    id,
    name,
    slug,
    logo_url,
    primary_color,
    secondary_color,
    description,
    active,
    metadata,
  })

  res.json({ brand })
}

// DELETE /admin/brands/:id - Delete a brand
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)
  const { id } = req.params

  await brandService.deleteBrands(id)

  res.status(200).json({
    id,
    object: "brand",
    deleted: true,
  })
}
