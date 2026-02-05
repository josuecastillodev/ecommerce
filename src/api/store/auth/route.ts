import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CUSTOMER_BRAND_MODULE } from "../../../modules/customer-brand"
import { BRAND_MODULE } from "../../../modules/brand"

/**
 * POST /store/auth
 * Authenticate a customer and validate brand access
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const { email, password, brand_id } = req.body as {
    email: string
    password: string
    brand_id: string
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const brandService = req.scope.resolve(BRAND_MODULE)
  const customerBrandService = req.scope.resolve(CUSTOMER_BRAND_MODULE)

  try {
    // 1. Validate brand exists and is active
    const [brand] = await brandService.listBrands({ id: brand_id })
    if (!brand) {
      res.status(404).json({
        type: "not_found",
        message: "La marca especificada no existe.",
      })
      return
    }

    if (!brand.active) {
      res.status(403).json({
        type: "forbidden",
        message: "La marca especificada no está activa.",
      })
      return
    }

    // 2. Authenticate with Medusa's auth module
    const authModule = req.scope.resolve("authModuleService")

    let authIdentity
    try {
      authIdentity = await authModule.authenticate("emailpass", {
        body: {
          email,
          password,
        },
      } as any)
    } catch (authError) {
      res.status(401).json({
        type: "unauthorized",
        message: "Email o contraseña incorrectos.",
      })
      return
    }

    if (!authIdentity.success) {
      res.status(401).json({
        type: "unauthorized",
        message: "Email o contraseña incorrectos.",
      })
      return
    }

    // 3. Get customer ID from auth identity
    const customerId = authIdentity.authIdentity?.app_metadata?.customer_id

    if (!customerId) {
      res.status(401).json({
        type: "unauthorized",
        message: "No se encontró el cliente asociado.",
      })
      return
    }

    // 4. Validate customer belongs to the requested brand
    const belongsToBrand = await customerBrandService.customerBelongsToBrand(
      customerId,
      brand_id
    )

    if (!belongsToBrand) {
      res.status(403).json({
        type: "brand_mismatch",
        message: "Tu cuenta no está asociada a esta marca. Inicia sesión en la tienda correcta.",
      })
      return
    }

    // 5. Get full customer data
    const { data: customers } = await query.graph({
      entity: "customer",
      fields: [
        "id",
        "email",
        "first_name",
        "last_name",
        "phone",
        "has_account",
        "created_at",
      ],
      filters: { id: customerId },
    })

    const customer = customers[0]

    if (!customer) {
      res.status(404).json({
        type: "not_found",
        message: "Cliente no encontrado.",
      })
      return
    }

    // 6. Get customer brand preferences
    const customerBrand = await customerBrandService.findByCustomerId(customerId)

    // 7. Generate session token
    const token = await generateSessionToken(authModule, customerId)

    // 8. Return customer data with token
    res.json({
      customer: {
        id: customer.id,
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name,
        phone: customer.phone,
        brand: {
          id: brand.id,
          name: brand.name,
          slug: brand.slug,
          logo_url: brand.logo_url,
          primary_color: brand.primary_color,
        },
        preferences: {
          marketing_consent: customerBrand?.marketing_consent || false,
          language_preference: customerBrand?.language_preference || "es",
        },
        created_at: customer.created_at,
      },
      token,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
    })
  } catch (error) {
    console.error("Authentication error:", error)
    res.status(500).json({
      type: "server_error",
      message: "Error al iniciar sesión. Intenta de nuevo.",
    })
  }
}

/**
 * DELETE /store/auth
 * Logout - invalidate session
 */
export async function DELETE(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  // In a real implementation, you would invalidate the session token
  // For now, we just return success
  res.json({
    success: true,
    message: "Sesión cerrada exitosamente.",
  })
}

/**
 * Generate a session token for the customer
 * In production, use JWT or your preferred token strategy
 */
async function generateSessionToken(
  authModule: any,
  customerId: string
): Promise<string> {
  // This is a simplified implementation
  // In production, use proper JWT signing
  const timestamp = Date.now()
  const randomPart = Math.random().toString(36).substring(2)
  const token = Buffer.from(
    JSON.stringify({
      customer_id: customerId,
      timestamp,
      random: randomPart,
    })
  ).toString("base64")

  return token
}
