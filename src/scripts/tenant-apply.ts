/**
 * Aplica una config de tenant desde un archivo JSON.
 *   pnpm run tenant:apply tenants/demo.json
 */
import { readFileSync } from "fs"
import path from "path"
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { TenantConfigSchema } from "../tenant/config-schema"
import { runTenantApply } from "../tenant/run-apply"

export default async function tenantApply({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const file = args.find((a) => a !== "--")
  if (!file) {
    throw new Error("Uso: pnpm run tenant:apply <archivo.json>")
  }

  const raw = JSON.parse(readFileSync(path.resolve(process.cwd(), file), "utf8"))
  const parsed = TenantConfigSchema.safeParse(raw)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      logger.error(`[tenant-apply] ${issue.path.join(".")}: ${issue.message}`)
    }
    throw new Error("Config de tenant inválida")
  }

  const result = await runTenantApply(container, parsed.data)
  logger.info(`[tenant-apply] Resultado: ${JSON.stringify(result, null, 2)}`)
}
