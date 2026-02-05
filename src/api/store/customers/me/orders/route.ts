import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /store/customers/me/orders
 * Get order history for the authenticated customer
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

  const { offset = 0, limit = 10, status } = req.query as {
    offset?: number
    limit?: number
    status?: string
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  try {
    // Build filters
    const filters: Record<string, any> = {
      customer_id: customerId,
    }

    if (status && status !== "all") {
      filters.status = status
    }

    // Get orders with items
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "status",
        "total",
        "subtotal",
        "tax_total",
        "shipping_total",
        "discount_total",
        "currency_code",
        "items.*",
        "items.variant.*",
        "items.variant.product.*",
        "shipping_address.*",
        "billing_address.*",
        "created_at",
        "updated_at",
      ],
      filters,
    })

    // Sort by created_at descending
    orders.sort((a: any, b: any) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )

    // Apply pagination
    const paginatedOrders = orders.slice(
      Number(offset),
      Number(offset) + Number(limit)
    )

    // Format currency helper
    const formatCurrency = (amount: number, currency: string = "MXN") => {
      return new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency,
      }).format(amount / 100)
    }

    // Format orders
    const formattedOrders = paginatedOrders.map((order: any) => ({
      id: order.id,
      display_id: order.display_id,
      status: order.status,
      status_display: getStatusDisplay(order.status),
      totals: {
        subtotal: order.subtotal,
        tax_total: order.tax_total,
        shipping_total: order.shipping_total,
        discount_total: order.discount_total,
        total: order.total,
        formatted_subtotal: formatCurrency(order.subtotal, order.currency_code),
        formatted_tax: formatCurrency(order.tax_total, order.currency_code),
        formatted_shipping: formatCurrency(order.shipping_total, order.currency_code),
        formatted_discount: formatCurrency(order.discount_total, order.currency_code),
        formatted_total: formatCurrency(order.total, order.currency_code),
      },
      currency_code: order.currency_code,
      items_count: order.items?.length || 0,
      items: (order.items || []).map((item: any) => ({
        id: item.id,
        title: item.title,
        quantity: item.quantity,
        unit_price: item.unit_price,
        formatted_unit_price: formatCurrency(item.unit_price, order.currency_code),
        total: item.unit_price * item.quantity,
        formatted_total: formatCurrency(item.unit_price * item.quantity, order.currency_code),
        thumbnail: item.variant?.product?.thumbnail || null,
        variant: item.variant
          ? {
              id: item.variant.id,
              sku: item.variant.sku,
              title: item.variant.title,
            }
          : null,
      })),
      shipping_address: order.shipping_address
        ? {
            first_name: order.shipping_address.first_name,
            last_name: order.shipping_address.last_name,
            address_1: order.shipping_address.address_1,
            city: order.shipping_address.city,
            postal_code: order.shipping_address.postal_code,
            country_code: order.shipping_address.country_code,
          }
        : null,
      created_at: order.created_at,
      updated_at: order.updated_at,
    }))

    res.json({
      orders: formattedOrders,
      count: orders.length,
      offset: Number(offset),
      limit: Number(limit),
    })
  } catch (error) {
    console.error("Get orders error:", error)
    res.status(500).json({
      type: "server_error",
      message: "Error al obtener los pedidos.",
    })
  }
}

/**
 * Get display text for order status
 */
function getStatusDisplay(status: string): string {
  const statusMap: Record<string, string> = {
    pending: "Pendiente",
    confirmed: "Confirmado",
    processing: "Procesando",
    shipped: "Enviado",
    delivered: "Entregado",
    canceled: "Cancelado",
    refunded: "Reembolsado",
    partially_refunded: "Reembolso parcial",
    requires_action: "Requiere acción",
  }
  return statusMap[status] || status
}
