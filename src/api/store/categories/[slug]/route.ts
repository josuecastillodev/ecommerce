/**
 * Store Category Detail API
 * GET /store/categories/:slug - Get category by slug
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CATEGORY_MODULE } from "../../../../modules/category"
import type CategoryModuleService from "../../../../modules/category/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const categoryService: CategoryModuleService = req.scope.resolve(CATEGORY_MODULE)
  const { slug } = req.params
  const { brand_id } = req.query

  // First try to find brand-specific category if brand_id provided
  let category = null

  if (brand_id) {
    category = await categoryService.findBySlug(slug, brand_id as string)
  }

  // If not found or no brand_id, try global category
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
