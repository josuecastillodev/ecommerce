/**
 * Escenarios de apply sobre una DB DESECHABLE (ver plan, "Entorno de
 * verificación"). Aborta si la DB ya tiene datos de tenant.
 *   DATABASE_URL=$SCRATCH_DB_URL npx medusa exec ./src/scripts/verify-tenant-apply.ts
 */
import { readFileSync } from "fs"
import path from "path"
import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { TenantConfigSchema, type TenantConfig } from "../tenant/config-schema"
import { BOOTSTRAP_MARKER } from "../tenant/initial-defaults"
import { runTenantApply } from "../tenant/run-apply"

function loadDemo(): TenantConfig {
  const raw = JSON.parse(readFileSync(path.resolve(process.cwd(), "tenants/demo.json"), "utf8"))
  return TenantConfigSchema.parse(raw)
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`[verify-tenant-apply] FAIL: ${msg}`)
}

async function counts(container: MedusaContainer) {
  const m = (k: string) => container.resolve(k) as any
  return {
    regions: (await m(Modules.REGION).listRegions()).length,
    taxRegions: (await m(Modules.TAX).listTaxRegions()).length,
    stockLocations: (await m(Modules.STOCK_LOCATION).listStockLocations()).length,
    shippingOptions: (await m(Modules.FULFILLMENT).listShippingOptions()).length,
    fulfillmentSets: (await m(Modules.FULFILLMENT).listFulfillmentSets()).length,
    salesChannels: (await m(Modules.SALES_CHANNEL).listSalesChannels()).length,
    publishableKeys: (await m(Modules.API_KEY).listApiKeys({ type: "publishable" })).length,
  }
}

export default async function verifyTenantApply({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const storeModule = container.resolve(Modules.STORE)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // Guarda: solo DB vacía.
  const [store0] = await storeModule.listStores()
  const { data: products0 } = await query.graph({ entity: "product", fields: ["id"] })
  const { data: brands0 } = await query.graph({ entity: "brand", fields: ["id"] })
  assert(!store0?.metadata?.[BOOTSTRAP_MARKER], "la DB ya tiene tenant_bootstrapped_at; usa una DB desechable")
  assert(products0.length === 0 && brands0.length === 0, "la DB tiene productos o marcas; usa una DB desechable")

  const demo = loadDemo()

  // Escenario 1: primer apply crea los valores iniciales y marca la tienda.
  const r1 = await runTenantApply(container, demo)
  assert(r1.bootstrapped === true, "primer apply debe reportar bootstrapped=true")
  const [store1] = await storeModule.listStores()
  assert(typeof store1?.metadata?.[BOOTSTRAP_MARKER] === "string", "falta el marcador en store.metadata")
  const c1 = await counts(container)
  assert(c1.regions === 1 && c1.taxRegions === 1 && c1.stockLocations === 1, `iniciales inesperados: ${JSON.stringify(c1)}`)
  assert(c1.shippingOptions === demo.initial.shipping_options.length, `opciones de envío: ${c1.shippingOptions}`)
  logger.info("[verify-tenant-apply] OK escenario 1: valores iniciales")

  // Escenario 2: segundo apply idéntico no cambia nada.
  const r2 = await runTenantApply(container, demo)
  assert(r2.bootstrapped === false, "segundo apply debe reportar bootstrapped=false")
  const c2 = await counts(container)
  assert(JSON.stringify(c1) === JSON.stringify(c2), `conteos cambiaron: ${JSON.stringify(c1)} -> ${JSON.stringify(c2)}`)
  logger.info("[verify-tenant-apply] OK escenario 2: idempotente")

  // Escenario 5: initial no se re-aplica (precio editado y config cambiada).
  const fulfillment = container.resolve(Modules.FULFILLMENT) as any
  const [option] = await fulfillment.listShippingOptions({ name: demo.initial.shipping_options[0].name })
  const regionsBefore = await (container.resolve(Modules.REGION) as any).listRegions()
  const changed: TenantConfig = {
    ...demo,
    initial: {
      ...demo.initial,
      region: { ...demo.initial.region, name: "Otra Región" },
      shipping_options: [{ ...demo.initial.shipping_options[0], name: "Envío Nuevo", amount: 1 }],
    },
  }
  await runTenantApply(container, changed)
  const regionsAfter = await (container.resolve(Modules.REGION) as any).listRegions()
  const optionsAfter = await fulfillment.listShippingOptions({ name: "Envío Nuevo" })
  assert(regionsAfter.length === regionsBefore.length && regionsAfter[0].name === regionsBefore[0].name, "apply re-aplicó la región")
  assert(optionsAfter.length === 0, "apply creó una opción de envío de initial tras el bootstrap")
  assert((await fulfillment.listShippingOptions({ id: option.id })).length === 1, "apply tocó una opción existente")
  logger.info("[verify-tenant-apply] OK escenario 5: initial no se re-aplica")

  logger.info("[verify-tenant-apply] Todos los escenarios pasan.")
}
