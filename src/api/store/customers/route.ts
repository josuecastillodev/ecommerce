import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CUSTOMER_BRAND_MODULE } from "../../../modules/customer-brand"
import { BRAND_MODULE } from "../../../modules/brand"

/**
 * POST /store/customers
 * Register a new customer associated with a specific brand
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const {
    email,
    password,
    first_name,
    last_name,
    phone,
    brand_id,
    marketing_consent,
  } = req.body as {
    email: string
    password: string
    first_name: string
    last_name: string
    phone?: string
    brand_id: string
    marketing_consent?: boolean
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

    // 2. Check if customer already exists with this email
    const { data: existingCustomers } = await query.graph({
      entity: "customer",
      fields: ["id", "email"],
      filters: { email },
    })

    if (existingCustomers.length > 0) {
      // Check if this customer is already associated with a brand
      const existingAssociation = await customerBrandService.findByCustomerId(
        existingCustomers[0].id
      )

      if (existingAssociation) {
        if (existingAssociation.brand_id === brand_id) {
          res.status(400).json({
            type: "already_exists",
            message: "Ya existe una cuenta con este email en esta marca.",
          })
          return
        } else {
          res.status(400).json({
            type: "brand_conflict",
            message: "Este email ya está registrado en otra marca. Cada email solo puede asociarse a una marca.",
          })
          return
        }
      }
    }

    // 3. Create customer using Medusa's customer module
    const customerModule = req.scope.resolve("customerModuleService")

    // Hash password and create customer
    const authModule = req.scope.resolve("authModuleService")

    const customer = await customerModule.createCustomers({
      email,
      first_name,
      last_name,
      phone: phone || null,
      has_account: true,
      metadata: {
        brand_id,
      },
    })

    // 4. Create auth identity for the customer
    await authModule.createAuthIdentities({
      provider_identities: [
        {
          provider: "emailpass",
          entity_id: email,
          provider_metadata: {
            password,
          },
        },
      ],
      app_metadata: {
        customer_id: customer.id,
      },
    })

    // 5. Associate customer with brand
    await customerBrandService.associateCustomerWithBrand(
      customer.id,
      brand_id,
      {
        registered_from: "storefront",
        marketing_consent: marketing_consent || false,
        language_preference: "es",
      }
    )

    // 6. Return customer data (without password)
    res.status(201).json({
      customer: {
        id: customer.id,
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name,
        phone: customer.phone,
        brand_id,
        brand_name: brand.name,
        brand_slug: brand.slug,
        created_at: customer.created_at,
      },
      message: "Registro exitoso. Ahora puedes iniciar sesión.",
    })
  } catch (error) {
    console.error("Customer registration error:", error)

    if (error instanceof Error && error.message.includes("already associated")) {
      res.status(400).json({
        type: "already_exists",
        message: error.message,
      })
      return
    }

    res.status(500).json({
      type: "server_error",
      message: "Error al registrar el cliente. Intenta de nuevo.",
    })
  }
}

/**
 * GET /store/customers
 * List customers for a brand (admin use)
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const brand_id = req.headers["x-brand-id"] as string
  const { offset = 0, limit = 20 } = req.query as {
    offset?: number
    limit?: number
  }

  if (!brand_id) {
    res.status(400).json({
      type: "invalid_request",
      message: "Se requiere el header X-Brand-Id.",
    })
    return
  }

  const customerBrandService = req.scope.resolve(CUSTOMER_BRAND_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  try {
    // Get customer-brand associations for this brand
    const associations = await customerBrandService.listByBrand(brand_id)
    const customerIds = associations.map((a: any) => a.customer_id)

    if (customerIds.length === 0) {
      res.json({
        customers: [],
        count: 0,
        offset: Number(offset),
        limit: Number(limit),
      })
      return
    }

    // Fetch full customer data
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
      ],
      filters: {
        id: customerIds,
      },
    })

    // Apply pagination
    const paginatedCustomers = customers.slice(
      Number(offset),
      Number(offset) + Number(limit)
    )

    // Add brand association data
    const customersWithBrand = paginatedCustomers.map((customer: any) => {
      const association = associations.find(
        (a: any) => a.customer_id === customer.id
      )
      return {
        ...customer,
        brand_id,
        marketing_consent: association?.marketing_consent || false,
        language_preference: association?.language_preference || "es",
      }
    })

    res.json({
      customers: customersWithBrand,
      count: customers.length,
      offset: Number(offset),
      limit: Number(limit),
    })
  } catch (error) {
    console.error("List customers error:", error)
    res.status(500).json({
      type: "server_error",
      message: "Error al obtener los clientes.",
    })
  }
}
