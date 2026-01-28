/**
 * Admin Categories Reorder API
 * POST /admin/categories/reorder - Reorder categories
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CATEGORY_MODULE } from "../../../../modules/category"
import type CategoryModuleService from "../../../../modules/category/service"
import { categoryValidators } from "../../../../modules/category/validators"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const categoryService: CategoryModuleService = req.scope.resolve(CATEGORY_MODULE)

  // Validate request body
  const parseResult = categoryValidators.reorderCategories.safeParse(req.body)

  if (!parseResult.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parseResult.error.flatten().fieldErrors,
    })
    return
  }

  const { category_ids, parent_id } = parseResult.data

  // Verify all categories exist
  for (const categoryId of category_ids) {
    try {
      await categoryService.retrieveCategory(categoryId)
    } catch {
      res.status(404).json({
        message: `Category ${categoryId} not found`,
      })
      return
    }
  }

  // If parent_id provided, validate it exists and depth is ok
  if (parent_id) {
    try {
      const parent = await categoryService.retrieveCategory(parent_id)
      if (parent.parent_id) {
        res.status(400).json({
          message: "Cannot set parent to a subcategory (max depth is 2 levels)",
        })
        return
      }
    } catch {
      res.status(404).json({
        message: `Parent category ${parent_id} not found`,
      })
      return
    }
  }

  // Reorder categories
  await categoryService.reorderCategories(category_ids, parent_id ?? null)

  // Get updated categories
  const categories = await Promise.all(
    category_ids.map((id) => categoryService.retrieveCategory(id))
  )

  res.json({
    categories,
    message: "Categories reordered successfully",
  })
}
