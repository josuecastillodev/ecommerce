import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /store/customers/me/addresses/:id
 * Get a specific address
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const customerId = (req as any).auth_context?.actor_id
  const addressId = req.params.id

  if (!customerId) {
    res.status(401).json({
      type: "unauthorized",
      message: "No autenticado.",
    })
    return
  }

  const customerModule = req.scope.resolve("customerModuleService")

  try {
    // Get customer with addresses
    const [customer] = await customerModule.listCustomers(
      { id: customerId },
      { relations: ["addresses"] }
    )

    const address = (customer.addresses || []).find(
      (a: any) => a.id === addressId
    )

    if (!address) {
      res.status(404).json({
        type: "not_found",
        message: "Dirección no encontrada.",
      })
      return
    }

    res.json({
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
        updated_at: address.updated_at,
      },
    })
  } catch (error) {
    console.error("Get address error:", error)
    res.status(500).json({
      type: "server_error",
      message: "Error al obtener la dirección.",
    })
  }
}

/**
 * PUT /store/customers/me/addresses/:id
 * Update a specific address
 */
export async function PUT(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const customerId = (req as any).auth_context?.actor_id
  const addressId = req.params.id

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
    country_code,
    phone,
    company,
    is_default_shipping,
    is_default_billing,
    metadata,
  } = req.body as {
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
  }

  const customerModule = req.scope.resolve("customerModuleService")

  try {
    // Verify address belongs to customer
    const [customer] = await customerModule.listCustomers(
      { id: customerId },
      { relations: ["addresses"] }
    )

    const existingAddress = (customer.addresses || []).find(
      (a: any) => a.id === addressId
    )

    if (!existingAddress) {
      res.status(404).json({
        type: "not_found",
        message: "Dirección no encontrada.",
      })
      return
    }

    // If setting as default, clear other defaults
    if (is_default_shipping || is_default_billing) {
      for (const addr of customer.addresses || []) {
        if (addr.id === addressId) continue

        const updates: Record<string, boolean> = {}
        if (is_default_shipping && addr.is_default_shipping) {
          updates.is_default_shipping = false
        }
        if (is_default_billing && addr.is_default_billing) {
          updates.is_default_billing = false
        }
        if (Object.keys(updates).length > 0) {
          await customerModule.updateAddresses({ id: addr.id, ...updates })
        }
      }
    }

    // Build update data
    const updateData: Record<string, any> = { id: addressId }

    if (first_name !== undefined) updateData.first_name = first_name
    if (last_name !== undefined) updateData.last_name = last_name
    if (address_1 !== undefined) updateData.address_1 = address_1
    if (address_2 !== undefined) updateData.address_2 = address_2
    if (city !== undefined) updateData.city = city
    if (province !== undefined) updateData.province = province
    if (postal_code !== undefined) updateData.postal_code = postal_code
    if (country_code !== undefined) updateData.country_code = country_code
    if (phone !== undefined) updateData.phone = phone
    if (company !== undefined) updateData.company = company
    if (is_default_shipping !== undefined)
      updateData.is_default_shipping = is_default_shipping
    if (is_default_billing !== undefined)
      updateData.is_default_billing = is_default_billing
    if (metadata !== undefined) updateData.metadata = metadata

    const address = await customerModule.updateAddresses(updateData)

    res.json({
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
        updated_at: address.updated_at,
      },
      message: "Dirección actualizada exitosamente.",
    })
  } catch (error) {
    console.error("Update address error:", error)
    res.status(500).json({
      type: "server_error",
      message: "Error al actualizar la dirección.",
    })
  }
}

/**
 * DELETE /store/customers/me/addresses/:id
 * Delete a specific address
 */
export async function DELETE(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const customerId = (req as any).auth_context?.actor_id
  const addressId = req.params.id

  if (!customerId) {
    res.status(401).json({
      type: "unauthorized",
      message: "No autenticado.",
    })
    return
  }

  const customerModule = req.scope.resolve("customerModuleService")

  try {
    // Verify address belongs to customer
    const [customer] = await customerModule.listCustomers(
      { id: customerId },
      { relations: ["addresses"] }
    )

    const address = (customer.addresses || []).find(
      (a: any) => a.id === addressId
    )

    if (!address) {
      res.status(404).json({
        type: "not_found",
        message: "Dirección no encontrada.",
      })
      return
    }

    // Don't allow deleting the only address if it's the default
    if (
      customer.addresses?.length === 1 &&
      (address.is_default_shipping || address.is_default_billing)
    ) {
      res.status(400).json({
        type: "invalid_request",
        message:
          "No puedes eliminar tu única dirección predeterminada. Agrega otra dirección primero.",
      })
      return
    }

    // Delete the address
    await customerModule.deleteAddresses([addressId])

    // If this was a default, assign new default to another address
    if (address.is_default_shipping || address.is_default_billing) {
      const remainingAddresses = customer.addresses?.filter(
        (a: any) => a.id !== addressId
      )
      if (remainingAddresses && remainingAddresses.length > 0) {
        const newDefault = remainingAddresses[0]
        const updates: Record<string, any> = { id: newDefault.id }
        if (address.is_default_shipping) updates.is_default_shipping = true
        if (address.is_default_billing) updates.is_default_billing = true
        await customerModule.updateAddresses(updates)
      }
    }

    res.json({
      success: true,
      message: "Dirección eliminada exitosamente.",
    })
  } catch (error) {
    console.error("Delete address error:", error)
    res.status(500).json({
      type: "server_error",
      message: "Error al eliminar la dirección.",
    })
  }
}
