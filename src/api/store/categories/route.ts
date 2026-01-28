/**
 * Store Categories API
 * GET /store/categories - List categories for a brand (includes global)
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CATEGORY_MODULE } from "../../../modules/category"
import type CategoryModuleService from "../../../modules/category/service"
import { categoryValidators } from "../../../modules/category/validators"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const categoryService: CategoryModuleService = req.scope.resolve(CATEGORY_MODULE)

  // Parse query params
  const parseResult = categoryValidators.listCategoriesQuery.safeParse(req.query)

  if (!parseResult.success) {
    res.status(400).json({
      message: "Invalid query parameters",
      errors: parseResult.error.flatten().fieldErrors,
    })
    return
  }

  const { brand_id, tree, include_global } = parseResult.data

  // If brand_id is provided and include_global is true, get combined categories
  if (brand_id && include_global === "true") {
    if (tree === "true") {
      // Return tree structure
      const categoryTree = await categoryService.getCategoryTreeForBrand(brand_id)
      res.json({
        categories: categoryTree,
        count: categoryTree.length,
      })
      return
    }

    // Return flat list
    const categories = await categoryService.getCategoriesForBrand(brand_id)
    res.json({
      categories,
      count: categories.length,
    })
    return
  }

  // If brand_id provided but include_global is false, get only brand categories
  if (brand_id) {
    if (tree === "true") {
      const categoryTree = await categoryService.getCategoryTree(brand_id)
      res.json({
        categories: categoryTree,
        count: categoryTree.length,
      })
      return
    }

    const categories = await categoryService.listCategories(
      { brand_id, is_active: true },
      { order: { position: "ASC", name: "ASC" } }
    )
    res.json({
      categories,
      count: categories.length,
    })
    return
  }

  // No brand_id - return global categories only
  if (tree === "true") {
    const categoryTree = await categoryService.getCategoryTree(null)
    res.json({
      categories: categoryTree,
      count: categoryTree.length,
    })
    return
  }

  const categories = await categoryService.listCategories(
    { brand_id: null, is_active: true },
    { order: { position: "ASC", name: "ASC" } }
  )

  res.json({
    categories,
    count: categories.length,
  })
}
