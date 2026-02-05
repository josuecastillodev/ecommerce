import { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"
import { CUSTOMER_BRAND_MODULE } from "../../modules/customer-brand"
import { BRAND_MODULE } from "../../modules/brand"

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
    const brandService = req.scope.resolve(BRAND_MODULE)
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

    if (!customerId) {
      return res.status(401).json({
        type: "unauthorized",
        message: "No autenticado.",
      })
    }

    if (!brandId) {
      return res.status(400).json({
        type: "invalid_request",
        message: "Se requiere brand_id.",
      })
    }

    const customerBrandService = req.scope.resolve(CUSTOMER_BRAND_MODULE)

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
 * Middleware to check if a customer can perform a cart/order action
 * Validates that products in cart belong to customer's brand
 */
export function validateCartBrandAccess() {
  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    const brandId = extractBrandId(req)
    const customerId = (req as any).auth_context?.actor_id

    if (!customerId || !brandId) {
      return next()
    }

    const customerBrandService = req.scope.resolve(CUSTOMER_BRAND_MODULE)

    try {
      const customerBrandId = await customerBrandService.getCustomerBrandId(customerId)

      if (customerBrandId && customerBrandId !== brandId) {
        return res.status(403).json({
          type: "forbidden",
          message: "No puedes comprar productos de otra marca.",
        })
      }

      next()
    } catch (error) {
      return res.status(500).json({
        type: "server_error",
        message: "Error al validar acceso al carrito.",
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
      const brandService = req.scope.resolve(BRAND_MODULE)
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
