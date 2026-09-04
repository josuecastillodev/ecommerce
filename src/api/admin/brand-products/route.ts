/**
 * Admin Products API
 * GET /admin/products - List products with brand filtering
 * POST /admin/products - Create product with brand
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { productValidators } from "../../../modules/product-extension"
import { createProductWithBrandWorkflow } from "../../../workflows/create-product-with-brand"

// GET /admin/products - List all products with filters
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Parse and validate query params
  const parseResult = productValidators.adminProductFilters.safeParse({
    brand_id: req.query.brand_id,
    category_id: req.query.category_id,
    status: req.query.status,
    min_price: req.query.min_price ? Number(req.query.min_price) : undefined,
    max_price: req.query.max_price ? Number(req.query.max_price) : undefined,
    sizes: req.query.sizes ? (req.query.sizes as string).split(",") : undefined,
    in_stock: req.query.in_stock === "true" ? true : undefined,
    offset: req.query.offset ? Number(req.query.offset) : 0,
    limit: req.query.limit ? Number(req.query.limit) : 20,
  })

  if (!parseResult.success) {
    res.status(400).json({
      message: "Invalid query parameters",
      errors: parseResult.error.flatten().fieldErrors,
    })
    return
  }

  const filters = parseResult.data

  // Build query filters
  const queryFilters: Record<string, unknown> = {}

  // Status filter (admin can see all statuses)
  if (filters.status && filters.status !== "all") {
    queryFilters.status = filters.status
  }

  // Brand filter through link
  let brandFilter: { brand_id: string } | undefined
  if (filters.brand_id) {
    brandFilter = { brand_id: filters.brand_id }
  }

  if (filters.category_id) {
    queryFilters.categories = { id: filters.category_id }
  }

  // Query products with all details for admin
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
      "updated_at",
      "metadata",
      "images.*",
      "options.*",
      "options.values.*",
      "variants.*",
      "variants.sku",
      "variants.prices.*",
      "variants.options.*",
      "variants.inventory_quantity",
      "categories.id",
      "categories.name",
      "categories.handle",
      "brand.*",
    ],
    filters: {
      ...queryFilters,
      ...(brandFilter && { brand: brandFilter }),
    },
    pagination: {
      skip: filters.offset,
      take: filters.limit,
      order: { created_at: "DESC" },
    },
  })

  // Enrich products with computed fields
  const enrichedProducts = products.map((product: any) => {
    const variants = product.variants || []
    const prices = variants.flatMap((v: any) =>
      v.prices?.map((p: any) => p.amount) || []
    )

    const totalStock = variants.reduce(
      (sum: number, v: any) => sum + (v.inventory_quantity || 0),
      0
    )

    return {
      ...product,
      price_range: prices.length > 0
        ? { min: Math.min(...prices), max: Math.max(...prices) }
        : null,
      total_stock: totalStock,
      variant_count: variants.length,
      in_stock: totalStock > 0,
    }
  })

  res.json({
    products: enrichedProducts,
    count: metadata?.count || enrichedProducts.length,
    offset: filters.offset,
    limit: filters.limit,
  })
}

// POST /admin/products - Create product with brand
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  // Validate request body
  const parseResult = productValidators.createProduct.safeParse(req.body)

  if (!parseResult.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parseResult.error.flatten().fieldErrors,
    })
    return
  }

  const input = parseResult.data

  // Run workflow to create product with brand
  const { result: product } = await createProductWithBrandWorkflow(req.scope).run({
    input: {
      brand_id: input.brand_id,
      title: input.title,
      slug: input.slug,
      description: input.description,
      subtitle: input.subtitle,
      handle: input.handle,
      thumbnail: input.thumbnail,
      images: input.images,
      base_price: input.base_price,
      currency_code: input.currency_code,
      category_ids: input.category_ids,
      variants: input.variants,
      status: input.status,
      metadata: input.metadata,
    },
  })

  res.status(201).json({ product })
}
