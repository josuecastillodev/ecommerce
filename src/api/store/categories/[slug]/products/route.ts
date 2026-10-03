/**
 * Store Category Products API
 * GET /store/categories/:slug/products - Get products in a category
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CATEGORY_MODULE } from "../../../../../modules/category"
import type CategoryModuleService from "../../../../../modules/category/service"
import { resolveCallerBrand } from "../../../../../utils/brand-middleware"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const categoryService: CategoryModuleService = req.scope.resolve(CATEGORY_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { slug } = req.params
  const {
    offset = "0",
    limit = "20",
    include_subcategories = "true",
  } = req.query

  // Scope to the caller's brand, derived from the publishable key's sales
  // channel(s). A client-supplied `brand_id` query param is ignored — a
  // storefront only ever sees its own brand's catalog.
  const callerBrand = await resolveCallerBrand(req)
  if (!callerBrand) {
    res.status(400).json({ message: "Missing publishable API key context" })
    return
  }

  const brand_id = callerBrand.id

  // Find category by slug
  let category = await categoryService.findBySlug(slug, brand_id as string)

  if (!category) {
    category = await categoryService.findBySlug(slug, null)
  }

  if (!category || !category.is_active) {
    res.status(404).json({ message: "Category not found" })
    return
  }

  // Collect category IDs to query (include subcategories if requested)
  const categoryIds = [category.id]

  if (include_subcategories === "true" && !category.parent_id) {
    const subcategories = await categoryService.getSubcategories(category.id)
    categoryIds.push(...subcategories.filter((c) => c.is_active).map((c) => c.id))
  }

  // Build filters — always scoped to the caller's brand.
  const filters: Record<string, unknown> = {
    status: "published",
    category: { id: categoryIds },
    brand: { id: brand_id },
  }

  // Query products
  const { data: products, metadata } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "subtitle",
      "description",
      "handle",
      "thumbnail",
      "status",
      "created_at",
      "images.*",
      "variants.*",
      "variants.prices.*",
      "variants.options.*",
      "brand.*",
      "category.*",
    ],
    filters,
    pagination: {
      skip: Number(offset),
      take: Number(limit),
      order: { created_at: "DESC" },
    },
  })

  // Enrich products with computed fields
  const enrichedProducts = products.map((product: any) => {
    const variants = product.variants || []
    const prices = variants.flatMap((v: any) =>
      v.prices?.map((p: any) => p.amount) || []
    )

    return {
      ...product,
      price_range: prices.length > 0
        ? { min: Math.min(...prices), max: Math.max(...prices) }
        : null,
      in_stock: variants.some((v: any) => (v.inventory_quantity || 0) > 0),
    }
  })

  res.json({
    products: enrichedProducts,
    count: metadata?.count || enrichedProducts.length,
    offset: Number(offset),
    limit: Number(limit),
    category: {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
    },
  })
}
