import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /store/customers/me/addresses
 * Get all addresses for the authenticated customer
 */
export async function GET(
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

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  try {
    const { data: customers } = await query.graph({
      entity: "customer",
      fields: ["addresses.*"],
      filters: { id: customerId },
    })

    const addresses = (customers[0]?.addresses || []).map((address: any) => ({
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
      created_at: address.created_at,
      updated_at: address.updated_at,
    }))

    res.json({
      addresses,
      count: addresses.length,
    })
  } catch (error) {
    console.error("Get addresses error:", error)
    res.status(500).json({
      type: "server_error",
      message: "Error al obtener las direcciones.",
    })
  }
}

/**
 * POST /store/customers/me/addresses
 * Create a new address for the authenticated customer
 */
export async function POST(
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

  const {
    first_name,
    last_name,
    address_1,
    address_2,
    city,
    province,
    postal_code,
    country_code = "MX",
    phone,
    company,
    is_default_shipping = false,
    is_default_billing = false,
    metadata,
  } = req.body as {
    first_name: string
    last_name: string
    address_1: string
    address_2?: string
    city: string
    province?: string
    postal_code: string
    country_code?: string
    phone?: string
    company?: string
    is_default_shipping?: boolean
    is_default_billing?: boolean
    metadata?: Record<string, unknown>
  }

  const customerModule = req.scope.resolve("customerModuleService")

  try {
    // If this is default, clear other defaults first
    if (is_default_shipping || is_default_billing) {
      const [customer] = await customerModule.listCustomers(
        { id: customerId },
        { relations: ["addresses"] }
      )

      for (const existingAddress of customer.addresses || []) {
        const updates: Record<string, boolean> = {}
        if (is_default_shipping && existingAddress.is_default_shipping) {
          updates.is_default_shipping = false
        }
        if (is_default_billing && existingAddress.is_default_billing) {
          updates.is_default_billing = false
        }
        if (Object.keys(updates).length > 0) {
          await customerModule.updateAddresses({
            id: existingAddress.id,
            ...updates,
          })
        }
      }
    }

    // Create the new address
    const address = await customerModule.createAddresses({
      customer_id: customerId,
      first_name,
      last_name,
      address_1,
      address_2: address_2 || null,
      city,
      province: province || null,
      postal_code,
      country_code,
      phone: phone || null,
      company: company || null,
      is_default_shipping,
      is_default_billing,
      metadata: metadata || null,
    })

    res.status(201).json({
      address: {
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
        is_default_shipping: address.is_default_shipping,
        is_default_billing: address.is_default_billing,
        metadata: address.metadata,
        created_at: address.created_at,
      },
      message: "Dirección creada exitosamente.",
    })
  } catch (error) {
    console.error("Create address error:", error)
    res.status(500).json({
      type: "server_error",
      message: "Error al crear la dirección.",
    })
  }
}

/**
 * PUT /store/customers/me/addresses
 * Update multiple addresses (bulk operation)
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

  const { addresses } = req.body as {
    addresses: Array<{
      id: string
      first_name?: string
      last_name?: string
      address_1?: string
      address_2?: string | null
      city?: string
      province?: string | null
      postal_code?: string
      country_code?: string
      phone?: string | null
      company?: string | null
      is_default_shipping?: boolean
      is_default_billing?: boolean
      metadata?: Record<string, unknown>
    }>
  }

  if (!addresses || !Array.isArray(addresses)) {
    res.status(400).json({
      type: "invalid_request",
      message: "Se requiere un array de direcciones.",
    })
    return
  }

  const customerModule = req.scope.resolve("customerModuleService")

  try {
    // Verify addresses belong to customer
    const [customer] = await customerModule.listCustomers(
      { id: customerId },
      { relations: ["addresses"] }
    )

    const customerAddressIds = new Set(
      (customer.addresses || []).map((a: any) => a.id)
    )

    const invalidIds = addresses.filter((a) => !customerAddressIds.has(a.id))
    if (invalidIds.length > 0) {
      res.status(403).json({
        type: "forbidden",
        message: "Algunas direcciones no pertenecen a tu cuenta.",
      })
      return
    }

    // Process default flags - only one default per type
    let newDefaultShipping: string | null = null
    let newDefaultBilling: string | null = null

    for (const addr of addresses) {
      if (addr.is_default_shipping) newDefaultShipping = addr.id
      if (addr.is_default_billing) newDefaultBilling = addr.id
    }

    // Update all addresses
    const updatedAddresses = []

    for (const addressData of addresses) {
      const updateData: Record<string, any> = { id: addressData.id }

      if (addressData.first_name !== undefined)
        updateData.first_name = addressData.first_name
      if (addressData.last_name !== undefined)
        updateData.last_name = addressData.last_name
      if (addressData.address_1 !== undefined)
        updateData.address_1 = addressData.address_1
      if (addressData.address_2 !== undefined)
        updateData.address_2 = addressData.address_2
      if (addressData.city !== undefined) updateData.city = addressData.city
      if (addressData.province !== undefined)
        updateData.province = addressData.province
      if (addressData.postal_code !== undefined)
        updateData.postal_code = addressData.postal_code
      if (addressData.country_code !== undefined)
        updateData.country_code = addressData.country_code
      if (addressData.phone !== undefined) updateData.phone = addressData.phone
      if (addressData.company !== undefined)
        updateData.company = addressData.company
      if (addressData.metadata !== undefined)
        updateData.metadata = addressData.metadata

      // Handle defaults
      if (newDefaultShipping) {
        updateData.is_default_shipping = addressData.id === newDefaultShipping
      } else if (addressData.is_default_shipping !== undefined) {
        updateData.is_default_shipping = addressData.is_default_shipping
      }

      if (newDefaultBilling) {
        updateData.is_default_billing = addressData.id === newDefaultBilling
      } else if (addressData.is_default_billing !== undefined) {
        updateData.is_default_billing = addressData.is_default_billing
      }

      const updated = await customerModule.updateAddresses(updateData)
      updatedAddresses.push(updated)
    }

    res.json({
      addresses: updatedAddresses.map((address: any) => ({
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
        is_default_shipping: address.is_default_shipping,
        is_default_billing: address.is_default_billing,
        updated_at: address.updated_at,
      })),
      message: "Direcciones actualizadas exitosamente.",
    })
  } catch (error) {
    console.error("Update addresses error:", error)
    res.status(500).json({
      type: "server_error",
      message: "Error al actualizar las direcciones.",
    })
  }
}
