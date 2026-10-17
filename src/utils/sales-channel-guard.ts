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
      const md = body.metadata ?? {}
      if (md[BRAND_METADATA_KEYS.slug] !== current.metadata?.[BRAND_METADATA_KEYS.slug])
        return reject(res, OWNED_BY_CONTROL_PLANE)
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
