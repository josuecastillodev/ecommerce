/**
 * POST /internal/tenant/apply — el control plane empuja la config del tenant.
 * Auth: requireControlPlaneToken() (src/api/middlewares.ts).
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { TenantConfigSchema } from "../../../../tenant/config-schema"
import { runTenantApply, TenantApplyLockedError } from "../../../../tenant/run-apply"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = TenantConfigSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      type: "invalid_data",
      message: "Config de tenant inválida",
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    })
  }

  try {
    const result = await runTenantApply(req.scope, parsed.data)
    return res.json(result)
  } catch (error) {
    if (error instanceof TenantApplyLockedError) {
      return res.status(409).json({ type: "conflict", message: error.message })
    }
    throw error
  }
}
