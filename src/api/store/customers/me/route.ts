import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CUSTOMER_BRAND_MODULE } from "../../../../modules/customer-brand"
import { BRAND_MODULE } from "../../../../modules/brand"

/**
 * GET /store/customers/me
 * Get authenticated customer's profile with addresses and order history
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const customerId = (req as any).auth_context?.actor_id

  if (!customerId) {
    res.status(401).json({
      type: "unauthorized",
      message: "No autenticado. Inicia sesión para continuar.",
    })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const brandService = req.scope.resolve(BRAND_MODULE)
  const customerBrandService = req.scope.resolve(CUSTOMER_BRAND_MODULE)

  try {
    // 1. Get customer data
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
        "updated_at",
        "addresses.*",
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

    // 2. Get customer-brand association
    const customerBrand = await customerBrandService.findByCustomerId(customerId)

    if (!customerBrand) {
      res.status(404).json({
        type: "not_found",
        message: "No se encontró asociación de marca para este cliente.",
      })
      return
    }

    // 3. Get brand details
    const [brand] = await brandService.listBrands({ id: customerBrand.brand_id })

    // 4. Get order history summary
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "total", "status", "created_at"],
      filters: { customer_id: customerId },
    })

    // Calculate order stats
    const ordersCount = orders.length
    const totalSpent = orders.reduce((sum: number, order: any) => {
      return sum + (order.total || 0)
    }, 0)

    // 5. Format addresses
    const addresses = (customer.addresses || []).map((address: any) => ({
      id: address.id,
      first_name: address.first_name,
      last_name: address.last_name,
      address_1: address.address_1,
      address_2: address.address_2,
      city: address.city,
      province: address.province,
      postal_code: address.postal_code,
      country_code: address.country_code,
      phone: address.phone,
      company: address.company,
      is_default_shipping: address.is_default_shipping || false,
      is_default_billing: address.is_default_billing || false,
      metadata: address.metadata,
    }))

    // 6. Return complete profile
    res.json({
      customer: {
        id: customer.id,
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name,
        phone: customer.phone,
        brand: brand
          ? {
              id: brand.id,
              name: brand.name,
              slug: brand.slug,
              logo_url: brand.logo_url,
              primary_color: brand.primary_color,
            }
          : null,
        preferences: {
          marketing_consent: customerBrand.marketing_consent,
          language_preference: customerBrand.language_preference,
        },
        addresses,
        stats: {
          orders_count: ordersCount,
          total_spent: totalSpent,
          formatted_total_spent: new Intl.NumberFormat("es-MX", {
            style: "currency",
            currency: "MXN",
          }).format(totalSpent / 100),
        },
        created_at: customer.created_at,
        updated_at: customer.updated_at,
      },
    })
  } catch (error) {
    console.error("Get customer profile error:", error)
    res.status(500).json({
      type: "server_error",
      message: "Error al obtener el perfil.",
    })
  }
}

/**
 * PUT /store/customers/me
 * Update authenticated customer's profile
 */
export async function PUT(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const customerId = (req as any).auth_context?.actor_id

  if (!customerId) {
    res.status(401).json({
      type: "unauthorized",
      message: "No autenticado.",
    })
    return
  }

  const { first_name, last_name, phone, marketing_consent, language_preference, metadata } =
    req.body as {
      first_name?: string
      last_name?: string
      phone?: string | null
      marketing_consent?: boolean
      language_preference?: string
      metadata?: Record<string, unknown>
    }

  const customerModule = req.scope.resolve("customerModuleService")
  const customerBrandService = req.scope.resolve(CUSTOMER_BRAND_MODULE)
  const brandService = req.scope.resolve(BRAND_MODULE)

  try {
    // 1. Update customer basic info
    const updateData: Record<string, any> = {}
    if (first_name !== undefined) updateData.first_name = first_name
    if (last_name !== undefined) updateData.last_name = last_name
    if (phone !== undefined) updateData.phone = phone

    if (Object.keys(updateData).length > 0) {
      await customerModule.updateCustomers({ id: customerId, ...updateData })
    }

    // 2. Update brand preferences if provided
    const preferencesUpdate: Record<string, any> = {}
    if (marketing_consent !== undefined)
      preferencesUpdate.marketing_consent = marketing_consent
    if (language_preference !== undefined)
      preferencesUpdate.language_preference = language_preference
    if (metadata !== undefined) preferencesUpdate.metadata = metadata

    if (Object.keys(preferencesUpdate).length > 0) {
      await customerBrandService.updateCustomerPreferences(
        customerId,
        preferencesUpdate
      )
    }

    // 3. Get updated customer data
    const [customer] = await customerModule.listCustomers({ id: customerId })
    const customerBrand = await customerBrandService.findByCustomerId(customerId)
    const [brand] = await brandService.listBrands({ id: customerBrand?.brand_id })

    res.json({
      customer: {
        id: customer.id,
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name,
        phone: customer.phone,
        brand: brand
          ? {
              id: brand.id,
              name: brand.name,
              slug: brand.slug,
            }
          : null,
        preferences: {
          marketing_consent: customerBrand?.marketing_consent || false,
          language_preference: customerBrand?.language_preference || "es",
        },
        updated_at: customer.updated_at,
      },
      message: "Perfil actualizado exitosamente.",
    })
  } catch (error) {
    console.error("Update customer profile error:", error)
    res.status(500).json({
      type: "server_error",
      message: "Error al actualizar el perfil.",
    })
  }
}
