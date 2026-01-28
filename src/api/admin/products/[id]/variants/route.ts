/**
 * Admin Product Variants API
 * GET /admin/products/:id/variants - List variants
 * POST /admin/products/:id/variants - Add variant
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { productValidators, AVAILABLE_SIZES } from "../../../../../modules/product-extension"
import { addVariantToProductWorkflow } from "../../../../../workflows/add-variant-to-product"

// GET /admin/products/:id/variants - List all variants for a product
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { id: productId } = req.params

  // Get product with variants
  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "variants.*",
      "variants.sku",
      "variants.prices.*",
      "variants.options.*",
      "variants.inventory_quantity",
      "brand.id",
      "brand.name",
      "brand.slug",
    ],
    filters: { id: productId },
  })

  if (products.length === 0) {
    res.status(404).json({ message: "Product not found" })
    return
  }

  const product = products[0] as any

  // Enrich variants with size/color info
  const variants = product.variants?.map((variant: any) => {
    const sizeOption = variant.options?.find(
      (o: any) => o.option?.title === "Talla"
    )
    const colorOption = variant.options?.find(
      (o: any) => o.option?.title === "Color"
    )

    return {
      id: variant.id,
      sku: variant.sku,
      title: variant.title,
      size: sizeOption?.value || null,
      color: {
        name: colorOption?.value || null,
        hex_code: variant.metadata?.color_hex || null,
      },
      stock: variant.inventory_quantity || 0,
      prices: variant.prices,
      in_stock: (variant.inventory_quantity || 0) > 0,
      created_at: variant.created_at,
      updated_at: variant.updated_at,
    }
  }) || []

  // Group by size for matrix view
  const sizeMatrix: Record<string, any[]> = {}
  for (const size of AVAILABLE_SIZES) {
    sizeMatrix[size] = variants.filter((v: any) => v.size === size)
  }

  res.json({
    product_id: productId,
    product_title: product.title,
    brand: product.brand,
    variants,
    variant_count: variants.length,
    total_stock: variants.reduce((sum: number, v: any) => sum + v.stock, 0),
    size_matrix: sizeMatrix,
  })
}

// POST /admin/products/:id/variants - Add a new variant
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id: productId } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Get product's brand
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "brand.id"],
    filters: { id: productId },
  })

  if (products.length === 0) {
    res.status(404).json({ message: "Product not found" })
    return
  }

  const product = products[0] as any
  const brandId = product.brand?.id

  if (!brandId) {
    res.status(400).json({ message: "Product is not linked to a brand" })
    return
  }

  // Validate request body
  const parseResult = productValidators.addVariant.safeParse({
    ...req.body,
    product_id: productId,
    brand_id: brandId,
  })

  if (!parseResult.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parseResult.error.flatten().fieldErrors,
    })
    return
  }

  const input = parseResult.data

  // Run workflow to add variant
  const { result: variant } = await addVariantToProductWorkflow(req.scope).run({
    input: {
      product_id: input.product_id,
      brand_id: input.brand_id,
      size: input.size,
      color: input.color,
      stock: input.stock,
      price: input.price,
    },
  })

  res.status(201).json({ variant })
}
