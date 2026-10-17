/**
 * Store Categories API
 * GET /store/categories - List categories for a brand (includes global)
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CATEGORY_MODULE } from "../../../modules/category"
import type CategoryModuleService from "../../../modules/category/service"
import { categoryValidators } from "../../../modules/category/validators"
import { resolveCallerBrand } from "../../../utils/brand-middleware"

// GET /store/categories - Categorías de la marca del caller (+ globales).
// Scopeado: la marca se deriva del sales channel de la publishable key, igual
// que /store/brands/:slug/products y /store/categories/:slug/products. Un
// `sales_channel_id` del query string se ignora.
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

  const { tree, include_global } = parseResult.data

  const callerBrand = await resolveCallerBrand(req)
  if (!callerBrand) {
    res.status(400).json({ message: "Missing publishable API key context" })
    return
  }
  const sales_channel_id = callerBrand.sales_channel_id

  // include_global !== "false" -> combinar categorías de la marca + globales.
  if (include_global !== "false") {
    if (tree === "true") {
      const categoryTree = await categoryService.getCategoryTreeForChannel(sales_channel_id)
      res.json({
        categories: categoryTree,
        count: categoryTree.length,
      })
      return
    }

    const categories = await categoryService.getCategoriesForChannel(sales_channel_id)
    res.json({
      categories,
      count: categories.length,
    })
    return
  }

  // include_global === "false" -> solo categorías propias de la marca.
  if (tree === "true") {
    const categoryTree = await categoryService.getCategoryTree(sales_channel_id)
    res.json({
      categories: categoryTree,
      count: categoryTree.length,
    })
    return
  }

  const categories = await categoryService.listCategories(
    { sales_channel_id, is_active: true },
    { order: { position: "ASC", name: "ASC" } }
  )
  res.json({
    categories,
    count: categories.length,
  })
}
