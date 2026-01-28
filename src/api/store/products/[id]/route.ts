/**
 * Store Product Detail API
 * GET /store/products/:id - Get single product with variants
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { id } = req.params

  // Query product with all related data
  const { data: products } = await query.graph({
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
      // Images
      "images.*",
      // Options (Talla, Color)
      "options.*",
      "options.values.*",
      // Variants with full details
      "variants.*",
      "variants.sku",
      "variants.prices.*",
      "variants.options.*",
      "variants.inventory_quantity",
      // Categories
      "categories.id",
      "categories.name",
      "categories.handle",
      "categories.parent_category.id",
      "categories.parent_category.name",
      // Brand (through link)
      "brand.*",
    ],
    filters: { id },
  })

  if (products.length === 0) {
    res.status(404).json({ message: "Product not found" })
    return
  }

  const product = products[0] as any

  // Only return published products
  if (product.status !== "published") {
    res.status(404).json({ message: "Product not found" })
    return
  }

  // Enrich variants with computed fields
  const enrichedVariants = product.variants?.map((variant: any) => {
    const sizeOption = variant.options?.find(
      (o: any) => o.option?.title === "Talla"
    )
    const colorOption = variant.options?.find(
      (o: any) => o.option?.title === "Color"
    )

    return {
      ...variant,
      size: sizeOption?.value || null,
      color: {
        name: colorOption?.value || null,
        hex_code: variant.metadata?.color_hex || null,
      },
      in_stock: (variant.inventory_quantity || 0) > 0,
      // Get MXN price as default
      price: variant.prices?.find((p: any) => p.currency_code === "MXN")?.amount ||
             variant.prices?.[0]?.amount,
      currency_code: variant.prices?.find((p: any) => p.currency_code === "MXN")?.currency_code ||
                     variant.prices?.[0]?.currency_code || "MXN",
    }
  }) || []

  // Get available sizes and colors
  const availableSizes = [...new Set(
    enrichedVariants
      .filter((v: any) => v.in_stock)
      .map((v: any) => v.size)
      .filter(Boolean)
  )]

  const availableColors = enrichedVariants
    .filter((v: any) => v.in_stock && v.color?.name)
    .reduce((acc: any[], v: any) => {
      if (!acc.find((c) => c.name === v.color.name)) {
        acc.push(v.color)
      }
      return acc
    }, [])

  // Calculate price range
  const prices = enrichedVariants.map((v: any) => v.price).filter(Boolean)
  const priceRange = prices.length > 0
    ? { min: Math.min(...prices), max: Math.max(...prices) }
    : null

  res.json({
    product: {
      ...product,
      variants: enrichedVariants,
      available_sizes: availableSizes,
      available_colors: availableColors,
      price_range: priceRange,
      total_inventory: enrichedVariants.reduce(
        (sum: number, v: any) => sum + (v.inventory_quantity || 0),
        0
      ),
    },
  })
}
