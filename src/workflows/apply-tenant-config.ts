/**
 * Aplica la config de un tenant (spec 2026-10-16). Invocar SIEMPRE vía
 * runTenantApply() (src/tenant/run-apply.ts), que toma el lock.
 */
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import type { TenantConfig } from "../tenant/config-schema"
import { applyInitialDefaults } from "../tenant/initial-defaults"

export type BrandApplyResult = {
  slug: string
  active: boolean
  sales_channel_id: string
  publishable_key: string | null
}

export type TenantApplyResult = {
  bootstrapped: boolean
  brands: BrandApplyResult[]
}

const applyInitialDefaultsStep = createStep(
  "apply-tenant-initial-defaults",
  async (config: TenantConfig, { container }) => {
    return new StepResponse(await applyInitialDefaults(container, config))
  }
)

export const applyTenantConfigWorkflow = createWorkflow(
  "apply-tenant-config",
  (input: TenantConfig) => {
    const initial = applyInitialDefaultsStep(input)
    const result = transform({ initial }, (d): TenantApplyResult => ({
      bootstrapped: d.initial.bootstrapped,
      brands: [],
    }))
    return new WorkflowResponse(result)
  }
)
