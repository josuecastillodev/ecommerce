/**
 * Self-check de channel-brand y de las reglas de `default` en la config.
 *   npx medusa exec ./src/scripts/check-channel-brand.ts
 */
import { readFileSync } from "fs"
import path from "path"
import { brandFromChannel, brandMetadata, BRAND_METADATA_KEYS } from "../brand/channel-brand"
import { TenantConfigSchema } from "../tenant/config-schema"

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`[check-channel-brand] FAIL: ${msg}`)
}

export default async function checkChannelBrand() {
  const base = { id: "sc_1", name: "Urban Street", description: "desc", is_disabled: false }

  assert(brandFromChannel({ ...base, metadata: null }) === null, "canal sin metadata no es marca")
  assert(brandFromChannel({ ...base, metadata: { brand_slug: "" } }) === null, "brand_slug vacío no es marca")

  const md = brandMetadata({ slug: "urban-street", logo_url: null, primary_color: "#111111", secondary_color: "#EEEEEE" })
  assert(md[BRAND_METADATA_KEYS.slug] === "urban-street", "brandMetadata escribe el slug")
  const brand = brandFromChannel({ ...base, is_disabled: true, metadata: md })
  assert(brand !== null, "canal con brand_slug es marca")
  assert(brand.sales_channel_id === "sc_1" && brand.slug === "urban-street", "id y slug")
  assert(brand.active === false, "is_disabled se invierte en active")
  assert(brand.logo_url === null, "logo vacío se lee como null")
  assert(brand.primary_color === "#111111" && brand.secondary_color === "#EEEEEE", "colores")
  assert(
    brandFromChannel({ ...base, metadata: { brand_slug: "x" } })!.primary_color === "#000000",
    "color primario por defecto"
  )

  const demo = JSON.parse(readFileSync(path.resolve(process.cwd(), "tenants/demo.json"), "utf8"))
  assert(TenantConfigSchema.safeParse(demo).success, "tenants/demo.json es válido")
  const noDefault = { ...demo, brands: demo.brands.map((b: any) => ({ ...b, default: false })) }
  assert(!TenantConfigSchema.safeParse(noDefault).success, "rechaza config sin marca default")
  const twoDefaults = { ...demo, brands: demo.brands.map((b: any) => ({ ...b, default: true })) }
  assert(!TenantConfigSchema.safeParse(twoDefaults).success, "rechaza dos marcas default")
  const inactiveDefault = {
    ...demo,
    brands: demo.brands.map((b: any) => (b.default ? { ...b, active: false } : b)),
  }
  assert(!TenantConfigSchema.safeParse(inactiveDefault).success, "rechaza marca default inactiva")

  console.log("[check-channel-brand] OK")
}
