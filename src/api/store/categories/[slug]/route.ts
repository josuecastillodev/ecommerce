/**
 * Store Category Detail API
 * GET /store/categories/:slug - Get category by slug
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CATEGORY_MODULE } from "../../../../modules/category"
import type CategoryModuleService from "../../../../modules/category/service"
import { resolveCallerBrand } from "../../../../utils/brand-middleware"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const categoryService: CategoryModuleService = req.scope.resolve(CATEGORY_MODULE)
  const { slug } = req.params

  const callerBrand = await resolveCallerBrand(req)
  if (!callerBrand) {
    res.status(400).json({ message: "Missing publishable API key context" })
    return
  }

  // Primero la categoría de la marca; si no, la global.
  let category = await categoryService.findBySlug(slug, callerBrand.sales_channel_id)
  if (!category) {
    category = await categoryService.findBySlug(slug, null)
  }

  if (!category || !category.is_active) {
    res.status(404).json({ message: "Category not found" })
    return
  }

  // Get subcategories if this is a root category
  let children: any[] = []
  if (!category.parent_id) {
    children = await categoryService.getSubcategories(category.id)
    children = children.filter((c) => c.is_active)
  }

  // Get parent if this is a subcategory
  let parent = null
  if (category.parent_id) {
    parent = await categoryService.retrieveCategory(category.parent_id)
  }

  res.json({
    category: {
      ...category,
      children,
      parent,
    },
  })
}
