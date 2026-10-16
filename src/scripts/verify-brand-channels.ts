/**
 * Probe de tenancy multi-marca (sin nombres a mano).
 *   npx medusa exec ./src/scripts/verify-brand-channels.ts
 */
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { checkTenancyInvariants } from "../tenant/invariants"

export default async function verifyBrandChannels({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { oks, failures } = await checkTenancyInvariants(container)
  oks.forEach((m) => logger.info(`[verify] OK ${m}`))
  failures.forEach((m) => logger.error(`[verify] FAIL: ${m}`))

  // El path del graph del que depende el cart guard debe resolver.
  try {
    const { data } = await query.graph({
      entity: "variant",
      fields: ["id", "product.sales_channels.id"],
      pagination: { take: 1 },
    })
    const row = (data as any[])[0]
    if (row && !Array.isArray(row.product?.sales_channels)) {
      failures.push("variant->product.sales_channels no resuelve (cart guard)")
    }
  } catch (e: any) {
    failures.push(`variant->product.sales_channels lanzó: ${e?.message ?? e}`)
  }

  if (failures.length > 0) {
    throw new Error(`[verify] ${failures.length} invariante(s) fallaron:\n- ${failures.join("\n- ")}`)
  }
  logger.info("[verify] Todas las invariantes de tenancy se cumplen.")
}
