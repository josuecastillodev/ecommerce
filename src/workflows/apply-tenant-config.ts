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
import type { TenantBrandConfig, TenantConfig } from "../tenant/config-schema"
import { applyInitialDefaults } from "../tenant/initial-defaults"
import { syncBrands, undoCreatedBrands } from "../tenant/sync-brands"

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

const syncBrandsStep = createStep(
  "sync-tenant-brands",
  async (brands: TenantBrandConfig[], { container }) => {
    const { results, created } = await syncBrands(container, brands)
    return new StepResponse(results, created)
  },
  async (created, { container }) => {
    if (!created) return
    await undoCreatedBrands(container, created)
  }
)

export const applyTenantConfigWorkflow = createWorkflow(
  "apply-tenant-config",
  (input: TenantConfig) => {
    // Orden secuencial: las marcas se ligan al almacén creado en el paso 1.
    const initial = applyInitialDefaultsStep(input)
    const brands = syncBrandsStep(input.brands)
    const result = transform({ initial, brands }, (d): TenantApplyResult => ({
      bootstrapped: d.initial.bootstrapped,
      brands: d.brands,
    }))
    return new WorkflowResponse(result)
  }
)
