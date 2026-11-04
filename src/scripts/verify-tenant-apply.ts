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
import { checkTenancyInvariants } from "../tenant/invariants"
import { runTenantApply } from "../tenant/run-apply"
import { syncBrands, undoCreatedBrands } from "../tenant/sync-brands"
import { brandFromChannel, BRAND_CHANNEL_FIELDS, type BrandChannel } from "../brand/channel-brand"

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

async function assertInvariants(container: MedusaContainer, label: string) {
  const { failures } = await checkTenancyInvariants(container)
  assert(failures.length === 0, `${label}: invariantes fallan:\n- ${failures.join("\n- ")}`)
}

async function channelBySlug(container: MedusaContainer, slug: string): Promise<BrandChannel | undefined> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "sales_channel", fields: BRAND_CHANNEL_FIELDS })
  return (data as unknown as BrandChannel[]).find((c) => brandFromChannel(c)?.slug === slug)
}

export default async function verifyTenantApply({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const storeModule = container.resolve(Modules.STORE)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // Guarda: solo DB vacía.
  const [store0] = await storeModule.listStores()
  const { data: products0 } = await query.graph({ entity: "product", fields: ["id"] })
  const { data: channels0 } = await query.graph({ entity: "sales_channel", fields: BRAND_CHANNEL_FIELDS })
  const branded0 = (channels0 as unknown as BrandChannel[]).filter((c) => brandFromChannel(c))
  assert(!store0?.metadata?.[BOOTSTRAP_MARKER], "la DB ya tiene tenant_bootstrapped_at; usa una DB desechable")
  assert(products0.length === 0 && branded0.length === 0, "la DB tiene productos o marcas; usa una DB desechable")

  const demo = loadDemo()

  // Escenario 1: primer apply crea los valores iniciales y marca la tienda.
  const r1 = await runTenantApply(container, demo)
  assert(r1.bootstrapped === true, "primer apply debe reportar bootstrapped=true")
  const [store1] = await storeModule.listStores()
  assert(typeof store1?.metadata?.[BOOTSTRAP_MARKER] === "string", "falta el marcador en store.metadata")
  const c1 = await counts(container)
  assert(c1.regions === 1 && c1.taxRegions === 1 && c1.stockLocations === 1, `iniciales inesperados: ${JSON.stringify(c1)}`)
  assert(c1.shippingOptions === demo.initial.shipping_options.length, `opciones de envío: ${c1.shippingOptions}`)
  assert(r1.brands.length === demo.brands.length, "resultado sin todas las marcas")
  assert(r1.brands.every((b) => b.active && b.publishable_key?.startsWith("pk_")), "marcas sin key")
  await assertInvariants(container, "escenario 1")
  const urbanDefault = await channelBySlug(container, demo.brands.find((b) => b.default)!.slug)
  assert(urbanDefault && urbanDefault.id === store1.default_sales_channel_id, "la marca default no adoptó el canal default del store")
  assert(c1.salesChannels === demo.brands.length, `se esperaba un canal por marca (sin canal default suelto): ${c1.salesChannels}`)
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

  // Escenario 3: agregar una marca, renombrar otra y quitar una tercera.
  const [urban, classic] = demo.brands
  const extra = { ...urban, slug: "acme-kids", name: "Acme Kids", default: false }
  const s3: TenantConfig = {
    ...demo,
    brands: [{ ...urban, name: "Urban Street MX" }, extra], // classic queda fuera
  }
  const r3 = await runTenantApply(container, s3)
  await assertInvariants(container, "escenario 3")
  const urbanRes = r3.brands.find((b) => b.slug === urban.slug)!
  const urbanChannel = await channelBySlug(container, urban.slug)
  assert(urbanChannel?.name === "Urban Street MX", `canal no renombrado: ${urbanChannel?.name}`)
  assert(r1.brands.find((b) => b.slug === urban.slug)!.sales_channel_id === urbanRes.sales_channel_id, "renombrar creó otro canal")
  const classicChannel = await channelBySlug(container, classic.slug)
  assert(classicChannel && classicChannel.is_disabled === true, "la marca quitada debe quedar con el canal deshabilitado, no borrada")
  logger.info("[verify-tenant-apply] OK escenario 3: agregar, renombrar, quitar")

  const oldClassicKey = r1.brands.find((b) => b.slug === classic.slug)!.publishable_key
  const { updateSalesChannelsWorkflow } = await import("@medusajs/medusa/core-flows")
  await updateSalesChannelsWorkflow(container).run({
    input: {
      selector: { id: classicChannel!.id },
      update: { metadata: { ...(classicChannel!.metadata ?? {}), brand_primary_color: "#ABCDEF" } },
    },
  })
  const r4 = await runTenantApply(container, demo)
  await assertInvariants(container, "escenario 4")
  const classicBack = brandFromChannel((await channelBySlug(container, classic.slug))!)!
  const classicRes = r4.brands.find((b) => b.slug === classic.slug)!
  assert(classicBack.active === true, "la marca no se reactivó")
  assert(classicBack.primary_color === "#ABCDEF", "apply pisó la apariencia editada por el cliente")
  assert(classicRes.publishable_key && classicRes.publishable_key !== oldClassicKey, "reactivar debe dar key nueva")
  logger.info("[verify-tenant-apply] OK escenario 4: reactivación conserva apariencia")

  // Escenario 6: mover la marca default a otra que ya tiene canal.
  const urbanBefore = brandFromChannel((await channelBySlug(container, urban.slug))!)!
  const s6: TenantConfig = {
    ...demo,
    brands: demo.brands.map((b) => ({ ...b, default: b.slug === classic.slug })),
  }
  await runTenantApply(container, s6)
  await assertInvariants(container, "escenario 6")
  const [store6] = await storeModule.listStores()
  assert(store6.default_sales_channel_id === classicRes.sales_channel_id, "no se movió store.default_sales_channel_id")
  const urbanAfter = brandFromChannel((await channelBySlug(container, urban.slug))!)!
  assert(urbanAfter.slug === urban.slug && urbanAfter.primary_color === urbanBefore.primary_color, "mover la default tocó el canal anterior")
  await runTenantApply(container, demo)
  const [store6b] = await storeModule.listStores()
  assert(store6b.default_sales_channel_id === urbanAfter.sales_channel_id, "no regresó la default a Urban Street")
  logger.info("[verify-tenant-apply] OK escenario 6: mover la marca default")

  // Escenario 7: una key de marca enlazada a otro canal se repara en el apply.
  const { linkSalesChannelsToApiKeyWorkflow, revokeApiKeysWorkflow, updateSalesChannelsWorkflow: updateChannels } =
    await import("@medusajs/medusa/core-flows")
  const apiKeyModule = container.resolve(Modules.API_KEY) as any
  const urbanId = (await channelBySlug(container, urban.slug))!.id
  const classicId = (await channelBySlug(container, classic.slug))!.id
  const linkedChannelIds = async (keyId: string) => {
    const { data } = await query.graph({ entity: "api_key", fields: ["id", "sales_channels.id"], filters: { id: keyId } })
    return ((data[0] as any).sales_channels as { id: string }[]).map((c) => c.id)
  }
  const [urbanKey] = await apiKeyModule.listApiKeys({ token: (await runTenantApply(container, demo)).brands.find((b) => b.slug === urban.slug)!.publishable_key })
  await linkSalesChannelsToApiKeyWorkflow(container).run({ input: { id: urbanKey.id, add: [classicId] } })
  assert((await linkedChannelIds(urbanKey.id)).length === 2, "no se pudo preparar la key con dos canales")
  await runTenantApply(container, demo)
  const repaired = await linkedChannelIds(urbanKey.id)
  assert(repaired.length === 1 && repaired[0] === urbanId, `key de Urban sin reparar: ${repaired}`)
  await assertInvariants(container, "escenario 7")
  logger.info("[verify-tenant-apply] OK escenario 7: key re-enlazada se repara")

  // Escenario 8: rollback. Se invoca syncBrands/undoCreatedBrands directo sobre el estado
  // del demo y se vuelve a aplicar el demo al final de cada caso.
  // 8a: mover la default y deshacer restaura store.default_sales_channel_id.
  const moved = await syncBrands(container, s6.brands)
  assert(moved.created.previousDefaultChannelId === urbanId, "8a: no registró la default previa")
  const [storeMoved] = await storeModule.listStores()
  assert(storeMoved.default_sales_channel_id === classicId, "8a: la default no se movió")
  await undoCreatedBrands(container, moved.created)
  const [storeUndone] = await storeModule.listStores()
  assert(storeUndone.default_sales_channel_id === urbanId, "8a: undo no restauró la default")
  await assertInvariants(container, "escenario 8a")
  logger.info("[verify-tenant-apply] OK escenario 8a: undo restaura la default")

  // 8b: adopción + canal y key nuevos; deshacer deja todo como antes del apply.
  const PREV_NAME = "Canal previo"
  await updateChannels(container).run({
    input: { selector: { id: urbanId }, update: { name: PREV_NAME, metadata: { brand_slug: "", brand_logo_url: "", brand_primary_color: "", brand_secondary_color: "" } } },
  })
  const urbanLive = await apiKeyModule.listApiKeys({ type: "publishable", revoked_at: null })
  const urbanKeyIds = (await Promise.all(urbanLive.map(async (k: any) => ((await linkedChannelIds(k.id)).includes(urbanId) ? k.id : null)))).filter(Boolean)
  await revokeApiKeysWorkflow(container).run({ input: { selector: { id: urbanKeyIds }, revoke: { revoked_by: "verify" } } })
  assert(!(await channelBySlug(container, urban.slug)), "8b: el canal default debe quedar sin marca")
  const keysBefore = (await counts(container)).publishableKeys
  const channelsBefore = (await counts(container)).salesChannels
  const withNew = await syncBrands(container, [...demo.brands, { ...urban, slug: "undo-kids", name: "Undo Kids", default: false }])
  assert(withNew.created.adoptedChannel?.id === urbanId, "8b: no adoptó el canal default")
  assert(withNew.created.channelIds.length === 1 && withNew.created.keyIds.length >= 2, "8b: no creó canal/keys")
  await undoCreatedBrands(container, withNew.created)
  const [store8] = await storeModule.listStores()
  assert(store8.default_sales_channel_id === urbanId, "8b: cambió la default")
  const adopted = (await query.graph({ entity: "sales_channel", fields: BRAND_CHANNEL_FIELDS, filters: { id: urbanId } })).data[0] as unknown as BrandChannel
  assert(brandFromChannel(adopted) === null, "8b: el canal adoptado conserva brand_*")
  assert(adopted.name === PREV_NAME, `8b: nombre no restaurado: ${adopted.name}`)
  assert(!(await channelBySlug(container, "undo-kids")), "8b: el canal creado sigue ahí")
  const after8 = await counts(container)
  assert(after8.salesChannels === channelsBefore, `8b: canales ${channelsBefore} -> ${after8.salesChannels}`)
  assert(after8.publishableKeys === keysBefore, `8b: keys ${keysBefore} -> ${after8.publishableKeys}`)
  logger.info("[verify-tenant-apply] OK escenario 8b: undo restaura el canal adoptado")
  await runTenantApply(container, demo)
  await assertInvariants(container, "tras escenario 8")

  logger.info("[verify-tenant-apply] Todos los escenarios pasan.")
}
