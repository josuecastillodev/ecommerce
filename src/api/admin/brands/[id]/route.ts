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

// Solo apariencia; nombre, slug y estado los manda el control plane.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)
  const { id } = req.params
  const body = req.validatedBody as {
    logo_url?: string | null
    primary_color?: string
    secondary_color?: string
    description?: string | null
  }

  // El ORM rechaza propiedades undefined: solo se pasan las enviadas.
  const brand = await brandService.updateBrands({ id, ...body })

  res.json({ brand })
}

// Las marcas nunca se borran: se desactivan desde el control plane.
export async function DELETE(_req: MedusaRequest, res: MedusaResponse) {
  res.status(403).json({
    type: "not_allowed",
    message: "Las marcas se desactivan desde el control plane del tenant.",
  })
}
