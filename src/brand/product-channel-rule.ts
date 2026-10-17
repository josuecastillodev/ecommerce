/**
 * Regla de marca para productos (spec 2026-10-17): todo producto está en
 * exactamente un sales channel, que es su marca.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

export async function findProductsNotInOneChannel(
  container: MedusaContainer,
  productIds: string[]
): Promise<{ id: string; title: string; channels: number }[]> {
  if (productIds.length === 0) return []
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "title", "sales_channels.id"],
    filters: { id: productIds },
  })
  return (data as any[])
    .map((p) => ({ id: p.id, title: p.title, channels: (p.sales_channels ?? []).length }))
    .filter((p) => p.channels !== 1)
}

export async function assertProductsInOneChannel(container: MedusaContainer, productIds: string[]) {
  const bad = await findProductsNotInOneChannel(container, productIds)
  if (bad.length === 0) return
  const detail = bad.map((p) => `"${p.title}" (${p.channels} canales)`).join(", ")
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    `Cada producto debe estar en exactamente un canal de venta (su marca): ${detail}.`
  )
}
