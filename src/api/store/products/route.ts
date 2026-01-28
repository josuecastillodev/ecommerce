/**
 * Store Products API
 * GET /store/products - List products with brand filtering
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { productValidators } from "../../../modules/product-extension"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Parse and validate query params
  const parseResult = productValidators.productFilters.safeParse({
    brand_id: req.query.brand_id,
    category_id: req.query.category_id,
    status: "published", // Store only shows published products
    min_price: req.query.min_price ? Number(req.query.min_price) : undefined,
    max_price: req.query.max_price ? Number(req.query.max_price) : undefined,
    sizes: req.query.sizes ? (req.query.sizes as string).split(",") : undefined,
    in_stock: req.query.in_stock === "true",
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
  const queryFilters: Record<string, unknown> = {
    status: "published",
  }

  // If brand_id is provided, we need to query through the link
  let brandFilter: { brand_id: string } | undefined
  if (filters.brand_id) {
    brandFilter = { brand_id: filters.brand_id }
  }

  if (filters.category_id) {
    queryFilters.categories = { id: filters.category_id }
  }

  // Query products with brand link
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
      "variants.prices.*",
      "variants.options.*",
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

  // Apply additional filters that can't be done in the query
  let filteredProducts = products

  // Filter by price range
  if (filters.min_price !== undefined || filters.max_price !== undefined) {
    filteredProducts = filteredProducts.filter((product: any) => {
      const prices = product.variants?.flatMap((v: any) =>
        v.prices?.map((p: any) => p.amount) || []
      ) || []

      if (prices.length === 0) return false

      const minProductPrice = Math.min(...prices)
      const maxProductPrice = Math.max(...prices)

      if (filters.min_price !== undefined && maxProductPrice < filters.min_price) {
        return false
      }
      if (filters.max_price !== undefined && minProductPrice > filters.max_price) {
        return false
      }
      return true
    })
  }

  // Filter by sizes
  if (filters.sizes && filters.sizes.length > 0) {
    filteredProducts = filteredProducts.filter((product: any) => {
      const productSizes = product.variants?.flatMap((v: any) =>
        v.options?.filter((o: any) => o.option?.title === "Talla").map((o: any) => o.value) || []
      ) || []

      return filters.sizes!.some((size) => productSizes.includes(size))
    })
  }

  // Filter by stock
  if (filters.in_stock) {
    filteredProducts = filteredProducts.filter((product: any) => {
      return product.variants?.some((v: any) =>
        v.inventory_quantity && v.inventory_quantity > 0
      )
    })
  }

  res.json({
    products: filteredProducts,
    count: metadata?.count || filteredProducts.length,
    offset: filters.offset,
    limit: filters.limit,
  })
}
