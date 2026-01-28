/**
 * Add Variant to Product Workflow
 * Adds a new variant to an existing product
 */

import {
  createWorkflow,
  WorkflowResponse,
  createStep,
  StepResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { createProductVariantsWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { BRAND_MODULE } from "../modules/brand"
import { SKUService } from "../modules/product-extension"
import type { AddVariantInput } from "../modules/product-extension/types"
import type BrandModuleService from "../modules/brand/service"

// Step: Get product and brand info
const getProductInfoStep = createStep(
  "get-product-info",
  async (input: { product_id: string; brand_id: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const brandService: BrandModuleService = container.resolve(BRAND_MODULE)

    // Get product
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "handle", "title"],
      filters: { id: input.product_id },
    })

    if (products.length === 0) {
      throw new Error(`Product with ID ${input.product_id} not found`)
    }

    // Get brand
    const brand = await brandService.retrieveBrand(input.brand_id)

    if (!brand) {
      throw new Error(`Brand with ID ${input.brand_id} not found`)
    }

    return new StepResponse({
      product_id: products[0].id,
      product_slug: products[0].handle,
      brand_slug: brand.slug,
    })
  }
)

// Step: Validate SKU uniqueness
const validateSKUStep = createStep(
  "validate-variant-sku",
  async (input: { sku: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: existingVariants } = await query.graph({
      entity: "product_variant",
      fields: ["id", "sku"],
      filters: { sku: input.sku },
    })

    if (existingVariants.length > 0) {
      throw new Error(`SKU ${input.sku} already exists`)
    }

    return new StepResponse({ validated: true })
  }
)

// Main workflow
export const addVariantToProductWorkflow = createWorkflow(
  "add-variant-to-product",
  (input: AddVariantInput) => {
    // Step 1: Get product and brand info
    const productInfo = getProductInfoStep({
      product_id: input.product_id,
      brand_id: input.brand_id,
    })

    // Step 2: Generate SKU
    const variantData = transform(
      { input, productInfo },
      ({ input, productInfo }) => {
        const sku = SKUService.generateForVariant(
          productInfo.brand_slug,
          productInfo.product_slug,
          input.size,
          input.color.name
        )

        return { sku }
      }
    )

    // Step 3: Validate SKU uniqueness
    validateSKUStep({ sku: variantData.sku })

    // Step 4: Create variant using core workflow
    const variantInput = transform(
      { input, variantData },
      ({ input, variantData }) => ({
        product_id: input.product_id,
        variants: [
          {
            title: `${input.size} / ${input.color.name}`,
            sku: variantData.sku,
            manage_inventory: true,
            inventory_quantity: input.stock,
            options: {
              Talla: input.size,
              Color: input.color.name,
            },
            prices: input.price
              ? [{ amount: input.price, currency_code: "MXN" }]
              : [],
            metadata: {
              color_hex: input.color.hex_code,
            },
          },
        ],
      })
    )

    const { result: variants } = createProductVariantsWorkflow.runAsStep({
      input: variantInput,
    })

    return new WorkflowResponse(
      transform({ variants, variantData }, ({ variants, variantData }) => ({
        ...variants[0],
        sku: variantData.sku,
      }))
    )
  }
)

export default addVariantToProductWorkflow
