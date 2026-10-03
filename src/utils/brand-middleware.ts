import { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CUSTOMER_BRAND_MODULE } from "../modules/customer-brand"
import { BRAND_MODULE } from "../modules/brand"
import type BrandModuleService from "../modules/brand/service"
import type CustomerBrandModuleService from "../modules/customer-brand/service"

/**
 * Extract brand_id from request
 * Priority: header > query > body
 */
export function extractBrandId(req: MedusaRequest): string | null {
  // 1. Check header (preferred for storefronts)
  const headerBrandId = req.headers["x-brand-id"] as string
  if (headerBrandId) {
    return headerBrandId
  }

  // 2. Check query params
  const queryBrandId = req.query.brand_id as string
  if (queryBrandId) {
    return queryBrandId
  }

  // 3. Check body
  const bodyBrandId = (req.body as any)?.brand_id as string
  if (bodyBrandId) {
    return bodyBrandId
  }

  return null
}

/**
 * Middleware to require brand_id in store requests
 * Storefronts should always send X-Brand-Id header
 */
export function requireBrandId() {
  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    const brandId = extractBrandId(req)

    if (!brandId) {
      return res.status(400).json({
        type: "invalid_request",
        message: "Se requiere brand_id. Envía el header X-Brand-Id o incluye brand_id en la petición.",
      })
    }

    // Validate that brand exists and is active
    const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)
    try {
      const [brand] = await brandService.listBrands({ id: brandId })

      if (!brand) {
        return res.status(404).json({
          type: "not_found",
          message: "La marca especificada no existe.",
        })
      }

      if (!brand.active) {
        return res.status(403).json({
          type: "forbidden",
          message: "La marca especificada no está activa.",
        })
      }

      // Attach brand to request for downstream use
      ;(req as any).brand = brand
      ;(req as any).brand_id = brandId

      next()
    } catch (error) {
      return res.status(500).json({
        type: "server_error",
        message: "Error al validar la marca.",
      })
    }
  }
}

/**
 * Middleware to validate that authenticated customer belongs to the request brand
 * Use this for protected routes where customer must match brand
 */
export function validateCustomerBrand() {
  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    const brandId = extractBrandId(req)
    const customerId = (req as any).auth_context?.actor_id

    // Authentication is enforced by Medusa's native customer auth middleware.
    // If it hasn't run / rejected yet, let the request continue to it.
    if (!customerId) {
      return next()
    }

    if (!brandId) {
      return res.status(400).json({
        type: "invalid_request",
        message: "Se requiere el header X-Brand-Id.",
      })
    }

    const customerBrandService: CustomerBrandModuleService = req.scope.resolve(CUSTOMER_BRAND_MODULE)

    try {
      const belongsToBrand = await customerBrandService.customerBelongsToBrand(
        customerId,
        brandId
      )

      if (!belongsToBrand) {
        return res.status(403).json({
          type: "forbidden",
          message: "No tienes acceso a esta marca. Tu cuenta está asociada a otra marca.",
        })
      }

      next()
    } catch (error) {
      return res.status(500).json({
        type: "server_error",
        message: "Error al validar acceso a la marca.",
      })
    }
  }
}

/**
 * Optional brand extraction middleware
 * Extracts brand_id if present but doesn't require it
 */
export function optionalBrandId() {
  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    const brandId = extractBrandId(req)

    if (brandId) {
      const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)
      try {
        const [brand] = await brandService.listBrands({ id: brandId })
        if (brand) {
          ;(req as any).brand = brand
          ;(req as any).brand_id = brandId
        }
      } catch (error) {
        // Silently continue without brand
      }
    }

    next()
  }
}

type VariantBrandInfo = {
  id: string
  channelIds: string[]
  brandId: string | null
}

/**
 * Resuelve, por variante, los sales channels de su producto y el id de su marca.
 * Fail-closed: si `query.graph` devuelve menos filas que las pedidas, lanza —
 * nunca se deja pasar una variante que no se pudo verificar.
 */
async function resolveVariantBrandInfo(
  query: any,
  variantIds: string[]
): Promise<VariantBrandInfo[]> {
  const { data: variants } = await query.graph({
    entity: "variant",
    fields: ["id", "product.brand.id", "product.sales_channels.id"],
    filters: { id: variantIds },
  })

  if (variants.length !== variantIds.length) {
    throw new Error(
      `variant lookup incompleto: pedidas ${variantIds.length}, devueltas ${variants.length}`
    )
  }

  return (variants as any[]).map((v) => ({
    id: v.id,
    channelIds: (v.product?.sales_channels ?? []).map((sc: any) => sc.id),
    brandId: v.product?.brand?.id ?? null,
  }))
}

/**
 * Rechaza (403) un conjunto de variantes que no puede convivir en un carrito:
 *
 * - Con `channelIds`: cada producto debe estar en alguno de esos sales channels.
 * - Sin `channelIds` (carrito sin canal resuelto): las variantes deben compartir
 *   una sola marca (`product.brand.id`); si abarcan >1, se rechaza.
 *
 * Devuelve el objeto de error listo para `res.status(403).json(...)`, o `null`
 * si el conjunto es válido.
 */
function checkVariantsAgainstChannel(
  infos: VariantBrandInfo[],
  channelIds: string[] | null
): { type: string; message: string } | null {
  if (channelIds && channelIds.length > 0) {
    const outsider = infos.find(
      (i) => !i.channelIds.some((id) => channelIds.includes(id))
    )
    if (outsider) {
      return {
        type: "not_allowed",
        message: "No puedes agregar productos de otra marca a este carrito.",
      }
    }
    return null
  }

  const brands = new Set(infos.map((i) => i.brandId).filter(Boolean) as string[])
  if (brands.size > 1) {
    return {
      type: "not_allowed",
      message: "No puedes mezclar productos de varias marcas en un carrito.",
    }
  }
  return null
}

/**
 * Middleware: impide que un carrito contenga productos de más de una marca.
 *
 * Medusa 2.20.1 NO valida la pertenencia de una variante al sales channel del
 * carrito (ni al agregar line items ni al completar). Este guard lo hace de
 * forma explícita: resuelve el `sales_channel_id` del carrito y rechaza (403)
 * si la variante entrante (`body.variant_id`) o cualquier line item ya
 * presente pertenece a un producto que no está en ese canal. Como cada canal
 * es 1:1 con una marca (link `brand ↔ sales_channel`), "otro canal" = "otra
 * marca".
 *
 * Si el carrito no tiene `sales_channel_id` resuelto, en vez de dejar pasar a
 * ciegas se exige que todas las variantes compartan una sola marca.
 *
 * Cablear en POST /store/carts/:id/line-items y POST /store/carts/:id/complete.
 */
export function validateCartLineItemBrand() {
  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    const cartId = req.params.id
    if (!cartId) {
      return next()
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    try {
      const { data: carts } = await query.graph({
        entity: "cart",
        fields: ["id", "sales_channel_id", "items.variant_id"],
        filters: { id: cartId },
      })
      const cart = carts[0]

      // Sin carrito: nada que validar, que responda el handler nativo.
      if (!cart) {
        return next()
      }

      const variantIds = new Set<string>()
      const incoming = (req.body as any)?.variant_id
      if (typeof incoming === "string" && incoming) {
        variantIds.add(incoming)
      }
      for (const item of cart.items ?? []) {
        if (item?.variant_id) {
          variantIds.add(item.variant_id)
        }
      }

      if (variantIds.size === 0) {
        return next()
      }

      const infos = await resolveVariantBrandInfo(query, Array.from(variantIds))
      const error = checkVariantsAgainstChannel(
        infos,
        cart.sales_channel_id ? [cart.sales_channel_id] : null
      )
      if (error) {
        return res.status(403).json(error)
      }

      return next()
    } catch (error) {
      return res.status(500).json({
        type: "server_error",
        message: "Error al validar la marca del carrito.",
      })
    }
  }
}

/**
 * Middleware: impide crear un carrito ya mixto vía `POST /store/carts` con
 * `items[]` inline. El guard de `:id/line-items` y `:id/complete` solo actúa
 * sobre carritos ya creados; sin esto, un `POST /store/carts` con variantes de
 * dos marcas nacía con 200.
 *
 * Canal objetivo: `body.sales_channel_id` explícito; si no, el de la
 * publishable key del request. Sin canal resuelto, se exige marca única.
 *
 * Cablear en POST /store/carts.
 */
export function validateCartCreateBrand() {
  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    const body = (req.body as any) ?? {}
    const items: any[] = Array.isArray(body.items) ? body.items : []
    const variantIds = Array.from(
      new Set(
        items
          .map((it) => it?.variant_id)
          .filter((v): v is string => typeof v === "string" && v.length > 0)
      )
    )

    if (variantIds.length === 0) {
      return next()
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    try {
      const bodyChannelId =
        typeof body.sales_channel_id === "string" && body.sales_channel_id
          ? body.sales_channel_id
          : null
      const keyChannelIds: string[] =
        (req as any).publishable_key_context?.sales_channel_ids ?? []
      const targetChannelIds = bodyChannelId
        ? [bodyChannelId]
        : keyChannelIds.length > 0
          ? keyChannelIds
          : null

      const infos = await resolveVariantBrandInfo(query, variantIds)
      const error = checkVariantsAgainstChannel(infos, targetChannelIds)
      if (error) {
        return res.status(403).json(error)
      }

      return next()
    } catch (error) {
      return res.status(500).json({
        type: "server_error",
        message: "Error al validar la marca del carrito.",
      })
    }
  }
}
