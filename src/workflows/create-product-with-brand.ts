import {
  createWorkflow,
  WorkflowResponse,
  createStep,
  StepResponse,
} from "@medusajs/framework/workflows-sdk"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { CreateProductWorkflowInputDTO } from "@medusajs/medusa/core-flows"

type CreateProductWithBrandInput = {
  product: CreateProductWorkflowInputDTO
  brand_id: string
}

const linkProductToBrandStep = createStep(
  "link-product-to-brand",
  async (
    input: { product_id: string; brand_id: string },
    { container }
  ) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)

    await remoteLink.create({
      brandModuleService: {
        brand_id: input.brand_id,
      },
      [Modules.PRODUCT]: {
        product_id: input.product_id,
      },
    })

    return new StepResponse({ product_id: input.product_id, brand_id: input.brand_id })
  },
  async (data, { container }) => {
    if (!data) return

    const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)

    await remoteLink.dismiss({
      brandModuleService: {
        brand_id: data.brand_id,
      },
      [Modules.PRODUCT]: {
        product_id: data.product_id,
      },
    })
  }
)

export const createProductWithBrandWorkflow = createWorkflow(
  "create-product-with-brand",
  (input: CreateProductWithBrandInput) => {
    // First, create the product using the core workflow
    const { result: products } = createProductsWorkflow.runAsStep({
      input: {
        products: [input.product],
      },
    })

    // Then, link the product to the brand
    linkProductToBrandStep({
      product_id: products[0].id,
      brand_id: input.brand_id,
    })

    return new WorkflowResponse(products[0])
  }
)
