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
      const cartChannelId = cart?.sales_channel_id

      // Sin carrito o sin canal: nada que validar, que siga el handler nativo.
      if (!cart || !cartChannelId) {
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

      const { data: variants } = await query.graph({
        entity: "variant",
        fields: ["id", "product.sales_channels.id"],
        filters: { id: Array.from(variantIds) },
      })

      if (variants.length !== variantIds.size) {
        return res.status(500).json({
          type: "server_error",
          message: "Error al validar la marca del carrito.",
        })
      }

      for (const variant of variants as any[]) {
        const channelIds: string[] = (variant.product?.sales_channels ?? []).map(
          (sc: any) => sc.id
        )
        if (!channelIds.includes(cartChannelId)) {
          return res.status(403).json({
            type: "not_allowed",
            message:
              "No puedes agregar productos de otra marca a este carrito.",
          })
        }
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
