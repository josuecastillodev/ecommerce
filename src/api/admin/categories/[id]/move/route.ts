/**
 * Admin Category Move API
 * POST /admin/categories/:id/move - Move category to new parent
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CATEGORY_MODULE } from "../../../../../modules/category"
import type CategoryModuleService from "../../../../../modules/category/service"
import { categoryValidators } from "../../../../../modules/category/validators"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const categoryService: CategoryModuleService = req.scope.resolve(CATEGORY_MODULE)
  const { id } = req.params

  // Validate request body
  const parseResult = categoryValidators.moveCategory.safeParse(req.body)

  if (!parseResult.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parseResult.error.flatten().fieldErrors,
    })
    return
  }

  const { new_parent_id } = parseResult.data

  // Can't move to itself
  if (new_parent_id === id) {
    res.status(400).json({
      message: "Cannot move category to itself",
    })
    return
  }

  try {
    const category = await categoryService.moveCategory(id, new_parent_id)

    // Get updated category with children and parent
    const children = await categoryService.getSubcategories(id)
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
  } catch (error: any) {
    res.status(400).json({ message: error.message })
  }
}
