/**
 * Create Product with Brand Workflow
 * Creates a product with variants and links it to a brand
 */

import {
  createWorkflow,
  WorkflowResponse,
  createStep,
  StepResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { BRAND_MODULE } from "../modules/brand"
import { SKUService } from "../modules/product-extension"
import type { CreateProductWithBrandInput, VariantInput } from "../modules/product-extension/types"
import type BrandModuleService from "../modules/brand/service"

// Step: Validate brand exists and is active
const validateBrandStep = createStep(
  "validate-brand",
  async (input: { brand_id: string }, { container }) => {
    const brandService: BrandModuleService = container.resolve(BRAND_MODULE)

    const brand = await brandService.retrieveBrand(input.brand_id)

    if (!brand) {
      throw new Error(`Brand with ID ${input.brand_id} not found`)
    }

    if (!brand.active) {
      throw new Error(`Brand ${brand.name} is not active`)
    }

    return new StepResponse({
      brand_id: brand.id,
      brand_slug: brand.slug,
      brand_name: brand.name,
    })
  }
)

// Step: Validate SKU uniqueness
const validateSKUUniquenessStep = createStep(
  "validate-sku-uniqueness",
  async (
    input: { skus: string[] },
    { container }
  ) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // Check if any of the SKUs already exist
    for (const sku of input.skus) {
      const { data: existingVariants } = await query.graph({
        entity: "product_variant",
        fields: ["id", "sku"],
        filters: { sku },
      })

      if (existingVariants.length > 0) {
        throw new Error(`SKU ${sku} already exists`)
      }
    }

    return new StepResponse({ validated: true })
  }
)

// Step: Link product to brand
const linkProductToBrandStep = createStep(
  "link-product-to-brand",
  async (
    input: { product_id: string; brand_id: string },
    { container }
  ) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)

    await remoteLink.create({
      [BRAND_MODULE]: {
        brand_id: input.brand_id,
      },
      [Modules.PRODUCT]: {
        product_id: input.product_id,
      },
    })

    return new StepResponse({
      product_id: input.product_id,
      brand_id: input.brand_id,
    })
  },
  async (data, { container }) => {
    if (!data) return

    const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)

    await remoteLink.dismiss({
      [BRAND_MODULE]: {
        brand_id: data.brand_id,
      },
      [Modules.PRODUCT]: {
        product_id: data.product_id,
      },
    })
  }
)

// Helper function to build variant options
function buildVariantOptions(variants: VariantInput[]) {
  const sizes = [...new Set(variants.map((v) => v.size))]
  const colors = [...new Set(variants.map((v) => v.color.name))]

  return [
    {
      title: "Talla",
      values: sizes,
    },
    {
      title: "Color",
      values: colors,
    },
  ]
}

// Main workflow
export const createProductWithBrandWorkflow = createWorkflow(
  "create-product-with-brand",
  (input: CreateProductWithBrandInput) => {
    // Step 1: Validate brand exists
    const brandData = validateBrandStep({ brand_id: input.brand_id })

    // Step 2: Generate product slug and SKUs
    const productData = transform(
      { input, brandData },
      ({ input, brandData }) => {
        const productSlug = input.slug || SKUService.generateProductSlug(input.title)

        // Generate SKUs for all variants
        const variantsWithSKU = input.variants.map((variant) => {
          const sku =
            variant.sku ||
            SKUService.generateForVariant(
              brandData.brand_slug,
              productSlug,
              variant.size,
              variant.color.name
            )

          return {
            ...variant,
            sku,
          }
        })

        return {
          productSlug,
          variantsWithSKU,
          skus: variantsWithSKU.map((v) => v.sku),
        }
      }
    )

    // Step 3: Validate SKU uniqueness
    validateSKUUniquenessStep({ skus: productData.skus })

    // Step 4: Build product input for Medusa core workflow
    const medusaProductInput = transform(
      { input, productData },
      ({ input, productData }) => {
        const options = buildVariantOptions(input.variants)

        const variants = productData.variantsWithSKU.map((variant) => ({
          title: `${variant.size} / ${variant.color.name}`,
          sku: variant.sku,
          manage_inventory: true,
          inventory_quantity: variant.stock,
          options: {
            Talla: variant.size,
            Color: variant.color.name,
          },
          prices: [
            {
              amount: variant.price || input.base_price,
              currency_code: input.currency_code || "MXN",
            },
          ],
          metadata: {
            color_hex: variant.color.hex_code,
          },
        }))

        return {
          title: input.title,
          subtitle: input.subtitle,
          description: input.description,
          handle: input.handle || productData.productSlug,
          thumbnail: input.thumbnail,
          images: input.images?.map((url) => ({ url })),
          status: input.status || "draft",
          options,
          variants,
          metadata: {
            ...input.metadata,
            brand_id: input.brand_id,
          },
        }
      }
    )

    // Step 5: Create product using core workflow
    const { result: products } = createProductsWorkflow.runAsStep({
      input: {
        products: [medusaProductInput],
      },
    })

    // Step 6: Get product ID and link to brand
    const productId = transform({ products }, ({ products }) => products[0].id)

    linkProductToBrandStep({
      product_id: productId,
      brand_id: input.brand_id,
    })

    // Return created product
    return new WorkflowResponse(
      transform({ products, brandData }, ({ products, brandData }) => ({
        ...products[0],
        brand: {
          id: brandData.brand_id,
          slug: brandData.brand_slug,
          name: brandData.brand_name,
        },
      }))
    )
  }
)

export default createProductWithBrandWorkflow
