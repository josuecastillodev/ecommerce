/**
 * Guarda de los datos de marca que posee el control plane (spec 2026-10-17):
 * desde el admin nativo no se crean ni borran canales, ni se cambia su nombre,
 * su estado o su brand_slug. Descripción, logo y colores sí (los edita el
 * cliente). Compara contra el valor actual, porque el form nativo de editar
 * canal manda `name` e `is_disabled` siempre, aunque no cambien.
 */
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { BRAND_CHANNEL_FIELDS, BRAND_METADATA_KEYS, type BrandChannel } from "../brand/channel-brand"

const OWNED_BY_CONTROL_PLANE =
  "Las marcas (canales de venta) las gestiona el control plane del tenant; aquí solo se edita su apariencia."
const SLUG_OWNED = "brand_slug no se puede cambiar ni borrar: lo gestiona el control plane del tenant."
const HEX = /^#[0-9A-Fa-f]{6}$/

const reject = (res: MedusaResponse, message: string) =>
  res.status(400).json({ type: "invalid_data", message })

export function guardSalesChannelCreate() {
  return (_req: MedusaRequest, res: MedusaResponse) => reject(res, OWNED_BY_CONTROL_PLANE)
}

export function guardSalesChannelDelete() {
  return (_req: MedusaRequest, res: MedusaResponse) => reject(res, OWNED_BY_CONTROL_PLANE)
}

export function guardSalesChannelUpdate() {
  return async (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
    const body = (req.body as any) ?? {}
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "sales_channel",
      fields: BRAND_CHANNEL_FIELDS,
      filters: { id: req.params.id },
    })
    const current = data[0] as unknown as BrandChannel | undefined
    if (!current) return next() // que el handler nativo responda 404

    if (body.name !== undefined && body.name !== current.name) return reject(res, OWNED_BY_CONTROL_PLANE)
    if (body.is_disabled !== undefined && body.is_disabled !== current.is_disabled)
      return reject(res, OWNED_BY_CONTROL_PLANE)

    if (body.metadata !== undefined) {
      const currentSlug = current.metadata?.[BRAND_METADATA_KEYS.slug]
      // Un objeto se fusiona con la metadata actual (mergeMetadata: "" borra la clave); `null` no pasa por el merge.
      if (body.metadata === null && currentSlug) return reject(res, SLUG_OWNED)
      const md = body.metadata ?? {}
      const slug = md[BRAND_METADATA_KEYS.slug]
      if (slug !== undefined && slug !== currentSlug) return reject(res, SLUG_OWNED)
      for (const key of [BRAND_METADATA_KEYS.primary_color, BRAND_METADATA_KEYS.secondary_color]) {
        const v = md[key]
        if (v !== undefined && v !== "" && !(typeof v === "string" && HEX.test(v)))
          return reject(res, `${key} debe ser un color hex #RRGGBB`)
      }
      const logo = md[BRAND_METADATA_KEYS.logo_url]
      if (logo !== undefined && logo !== "" && !(typeof logo === "string" && URL.canParse(logo) && ["http:", "https:"].includes(new URL(logo).protocol)))
        return reject(res, `${BRAND_METADATA_KEYS.logo_url} debe ser una URL http(s)`)
    }
    return next()
  }
}

/**
 * POST /admin/api-keys/:id/sales-channels: las keys de las marcas las crea y
 * enlaza el control plane (apply). Desde el admin no se re-enlaza una key de
 * marca ni se agrega un canal de marca a ninguna publishable key: rompería el
 * aislamiento entre marcas. El apply repara la key si aun así ocurre.
 */
export function guardApiKeySalesChannels() {
  return async (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "api_key",
      fields: ["id", "type", "sales_channels.id", "sales_channels.metadata"],
      filters: { id: req.params.id },
    })
    const key = data[0] as any
    if (!key) return next() // que el handler nativo responda 404
    if (key.type !== "publishable") return next()

    const isBrand = (sc: any) => Boolean(sc?.metadata?.[BRAND_METADATA_KEYS.slug])
    if ((key.sales_channels ?? []).some(isBrand)) return reject(res, OWNED_BY_CONTROL_PLANE)

    const add: string[] = Array.isArray((req.body as any)?.add) ? (req.body as any).add : []
    if (add.length > 0) {
      const { data: added } = await query.graph({
        entity: "sales_channel",
        fields: ["id", "metadata"],
        filters: { id: add },
      })
      if ((added as any[]).some(isBrand)) return reject(res, OWNED_BY_CONTROL_PLANE)
    }
    return next()
  }
}
