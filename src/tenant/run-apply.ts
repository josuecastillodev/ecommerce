/**
 * Única forma de correr el apply: toma el lock `tenant-apply` (Redis, sin
 * espera) para que server y CLI nunca apliquen a la vez.
 */
import { randomUUID } from "crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import type { TenantConfig } from "./config-schema"
import {
  applyTenantConfigWorkflow,
  type TenantApplyResult,
} from "../workflows/apply-tenant-config"

export const TENANT_APPLY_LOCK = "tenant-apply"
const LOCK_EXPIRE_SECONDS = 600

export class TenantApplyLockedError extends Error {
  constructor() {
    super("Ya hay un apply de tenant en curso")
  }
}

export async function runTenantApply(
  container: MedusaContainer,
  config: TenantConfig
): Promise<TenantApplyResult> {
  const locking = container.resolve(Modules.LOCKING)
  const ownerId = randomUUID()

  try {
    await locking.acquire(TENANT_APPLY_LOCK, { ownerId, expire: LOCK_EXPIRE_SECONDS })
  } catch (error: any) {
    if (error instanceof MedusaError && error.type === MedusaError.Types.CONFLICT) {
      throw new TenantApplyLockedError()
    }
    throw error
  }

  try {
    const { result } = await applyTenantConfigWorkflow(container).run({ input: config })
    return result
  } finally {
    await locking.release(TENANT_APPLY_LOCK, { ownerId })
  }
}
