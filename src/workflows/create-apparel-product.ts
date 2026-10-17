/**
 * Create Apparel Product Workflow — crea un producto de ropa (tallas × colores, SKUs) en el sales channel de su marca. Lo usa el seed de demo.
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
import { SKUService } from "../modules/product-extension"
import type { CreateApparelProductInput, VariantInput } from "../modules/product-extension/types"

// Step: Resolve the shipping profile to attach the product to.
// createProductsWorkflow silently skips the fulfillment link when
// shipping_profile_id is missing, which leaves the product unroutable — cart
// completion then fails with "shipping profiles that are not satisfied by
// the current shipping methods" for every product created this way.
const resolveShippingProfileStep = createStep(
  "resolve-shipping-profile",
  async (_input: void, { container }) => {
    const fulfillmentModule = container.resolve(Modules.FULFILLMENT)
    const [profile] = await fulfillmentModule.listShippingProfiles(
      { type: "default" },
      { take: 1 }
    )

    if (!profile) {
      throw new Error(
        "No default shipping profile found. Create one before adding products."
      )
    }

    return new StepResponse({ shipping_profile_id: profile.id })
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
export const createApparelProductWorkflow = createWorkflow(
  "create-apparel-product",
  (input: CreateApparelProductInput) => {
    // Step 2: Generate product slug and SKUs
    const productData = transform(
      { input },
      ({ input }) => {
        const productSlug = input.slug || SKUService.generateProductSlug(input.title)

        // Generate SKUs for all variants
        const variantsWithSKU = input.variants.map((variant) => {
          const sku =
            variant.sku ||
            SKUService.generateForVariant(
              input.sku_prefix,
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

    // Step 3b: Resolve the default shipping profile
    const shippingProfileData = resolveShippingProfileStep()

    // Step 4: Build product input for Medusa core workflow
    const medusaProductInput = transform(
      { input, productData, shippingProfileData },
      ({ input, productData, shippingProfileData }) => {
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
          shipping_profile_id: shippingProfileData.shipping_profile_id,
          options,
          variants,
          sales_channels: [{ id: input.sales_channel_id }],
          metadata: input.metadata,
        }
      }
    )

    // Step 5: Create product using core workflow.
    // runAsStep() returns the workflow's response value directly (the product
    // array), not a { result } wrapper.
    const products = createProductsWorkflow.runAsStep({
      input: {
        products: [medusaProductInput],
      },
    })

    return new WorkflowResponse(transform({ products }, ({ products }) => products[0]))
  }
)

export default createApparelProductWorkflow
