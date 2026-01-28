/**
 * Admin Product Detail API
 * GET /admin/products/:id - Get single product
 * POST /admin/products/:id - Update product
 * DELETE /admin/products/:id - Delete product
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { updateProductsWorkflow, deleteProductsWorkflow } from "@medusajs/medusa/core-flows"
import { productValidators } from "../../../../modules/product-extension"

// GET /admin/products/:id - Get single product with full details
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { id } = req.params

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
      "images.*",
      "options.*",
      "options.values.*",
      "variants.*",
      "variants.sku",
      "variants.prices.*",
      "variants.options.*",
      "variants.inventory_quantity",
      "categories.*",
      "brand.*",
    ],
    filters: { id },
  })

  if (products.length === 0) {
    res.status(404).json({ message: "Product not found" })
    return
  }

  const product = products[0] as any

  // Enrich variants
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
    }
  }) || []

  res.json({
    product: {
      ...product,
      variants: enrichedVariants,
      total_stock: enrichedVariants.reduce(
        (sum: number, v: any) => sum + (v.inventory_quantity || 0),
        0
      ),
    },
  })
}

// POST /admin/products/:id - Update product
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  // Validate request body
  const parseResult = productValidators.updateProduct.safeParse({
    ...req.body,
    id,
  })

  if (!parseResult.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parseResult.error.flatten().fieldErrors,
    })
    return
  }

  const input = parseResult.data

  // Build update object
  const updateData: Record<string, unknown> = { id }

  if (input.title !== undefined) updateData.title = input.title
  if (input.description !== undefined) updateData.description = input.description
  if (input.subtitle !== undefined) updateData.subtitle = input.subtitle
  if (input.thumbnail !== undefined) updateData.thumbnail = input.thumbnail
  if (input.status !== undefined) updateData.status = input.status
  if (input.metadata !== undefined) updateData.metadata = input.metadata

  // Handle images update
  if (input.images !== undefined) {
    updateData.images = input.images.map((url) => ({ url }))
  }

  // Run update workflow
  const { result: products } = await updateProductsWorkflow(req.scope).run({
    input: {
      products: [updateData],
    },
  })

  // Handle category updates separately if needed
  if (input.category_ids !== undefined) {
    const remoteLink = req.scope.resolve(ContainerRegistrationKeys.REMOTE_LINK)

    // Remove existing category links
    await remoteLink.dismiss({
      [Modules.PRODUCT]: { product_id: id },
      [Modules.PRODUCT]: { product_category_id: "*" },
    })

    // Add new category links
    for (const categoryId of input.category_ids) {
      await remoteLink.create({
        [Modules.PRODUCT]: { product_id: id },
        [Modules.PRODUCT]: { product_category_id: categoryId },
      })
    }
  }

  res.json({ product: products[0] })
}

// DELETE /admin/products/:id - Delete product
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  // Delete product (this will also clean up links due to cascade)
  await deleteProductsWorkflow(req.scope).run({
    input: { ids: [id] },
  })

  res.status(200).json({
    id,
    object: "product",
    deleted: true,
  })
}
