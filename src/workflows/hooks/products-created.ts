/**
 * Liga los productos creados por POST /admin/products a la marca de
 * `additional_data.brand_id` y los deja solo en el sales channel de esa marca.
 * `requireProductBrand()` garantiza que el admin siempre mande la marca;
 * `createProductWithBrandWorkflow` no manda additional_data y liga por su cuenta.
 */
import { createProductsWorkflow, linkProductsToSalesChannelWorkflow } from "@medusajs/medusa/core-flows"
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { BRAND_MODULE } from "../../modules/brand"

createProductsWorkflow.hooks.productsCreated(
  async ({ products, additional_data }, { container }) => {
    const brandId = additional_data?.brand_id as string | undefined
    if (!brandId) {
      return new StepResponse(undefined, undefined)
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: [brand] } = await query.graph({
      entity: "brand",
      fields: ["id", "active", "sales_channel.id"],
      filters: { id: brandId },
    })
    if (!brand) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `Brand ${brandId} not found`)
    }
    if (!brand.active) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `Brand ${brandId} is not active`)
    }
    const channelId = (brand as any).sales_channel?.id
    if (!channelId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Brand ${brandId} has no sales channel linked. Run "pnpm run seed" to provision per-brand channels.`
      )
    }

    const productIds = products.map((p) => p.id)
    const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)
    await remoteLink.create(
      productIds.map((product_id) => ({
        [BRAND_MODULE]: { brand_id: brandId },
        [Modules.PRODUCT]: { product_id },
      }))
    )

    // El form nativo asigna el canal default; el producto debe vivir solo en el de su marca.
    const { data: withChannels } = await query.graph({
      entity: "product",
      fields: ["id", "sales_channels.id"],
      filters: { id: productIds },
    })
    const otherChannels = new Set(
      withChannels.flatMap((p: any) => (p.sales_channels ?? []).map((sc: any) => sc.id))
    )
    otherChannels.delete(channelId)
    for (const id of otherChannels) {
      await linkProductsToSalesChannelWorkflow(container).run({
        input: { id, add: [], remove: productIds },
      })
    }
    await linkProductsToSalesChannelWorkflow(container).run({
      input: { id: channelId, add: productIds, remove: [] },
    })

    return new StepResponse(undefined, { brandId, channelId, productIds })
  },
  async (data, { container }) => {
    if (!data) return
    const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)
    await remoteLink.dismiss(
      data.productIds.map((product_id) => ({
        [BRAND_MODULE]: { brand_id: data.brandId },
        [Modules.PRODUCT]: { product_id },
      }))
    )
    await linkProductsToSalesChannelWorkflow(container).run({
      input: { id: data.channelId, add: [], remove: data.productIds },
    })
  }
)
