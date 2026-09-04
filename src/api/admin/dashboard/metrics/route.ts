/**
 * Admin Dashboard Metrics
 * GET /admin/dashboard/metrics?brand_id=<optional>
 *
 * Aggregates real data:
 *  - products_count / low_stock_count: from the product<->brand link + inventory location levels
 *  - orders_today / orders_pending / total_sales: from orders, bucketed to a brand
 *    through order.items -> product -> brand (there is no direct brand<->order link)
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const LOW_STOCK_THRESHOLD = 10

type BrandBucket = {
  brand_id: string
  brand_name: string
  total_sales: number
  orders_today: number
  orders_pending: number
  products_count: number
  low_stock_count: number
  currency: string
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const brandIdFilter = (req.query.brand_id as string) || undefined

  // --- Brands ---
  const { data: brands } = await query.graph({
    entity: "brand",
    fields: ["id", "name"],
    ...(brandIdFilter ? { filters: { id: brandIdFilter } } : {}),
  })

  const buckets = new Map<string, BrandBucket>()
  for (const b of brands) {
    buckets.set(b.id, {
      brand_id: b.id,
      brand_name: b.name,
      total_sales: 0,
      orders_today: 0,
      orders_pending: 0,
      products_count: 0,
      low_stock_count: 0,
      currency: "mxn",
    })
  }

  // --- Products + inventory per brand ---
  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "brand.id",
      "variants.inventory_items.inventory.location_levels.stocked_quantity",
      "variants.inventory_items.inventory.location_levels.reserved_quantity",
    ],
    ...(brandIdFilter ? { filters: { brand: { id: brandIdFilter } } } : {}),
  })

  const productBrand = new Map<string, string>()
  for (const p of products as any[]) {
    const bId = p.brand?.id
    if (!bId || !buckets.has(bId)) continue
    productBrand.set(p.id, bId)
    const bucket = buckets.get(bId)!
    bucket.products_count += 1
    const stock = (p.variants || []).reduce((sum: number, v: any) => {
      const levels =
        v.inventory_items?.flatMap((ii: any) => ii.inventory?.location_levels ?? []) ?? []
      return (
        sum +
        levels.reduce(
          (s: number, l: any) =>
            s + ((l.stocked_quantity ?? 0) - (l.reserved_quantity ?? 0)),
          0
        )
      )
    }, 0)
    if (stock <= LOW_STOCK_THRESHOLD) bucket.low_stock_count += 1
  }

  // --- Orders (bucketed via line item product -> brand) ---
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "status",
      "created_at",
      "items.product_id",
      "items.total",
    ],
  })

  const today = startOfToday()
  let totalOrdersToday = 0
  let pendingOrders = 0

  for (const o of orders as any[]) {
    const createdToday = new Date(o.created_at) >= today
    const isPending = o.status === "pending" || o.status === "requires_action"
    if (createdToday) totalOrdersToday += 1
    if (isPending) pendingOrders += 1

    const brandIdsInOrder = new Set<string>()
    for (const item of o.items || []) {
      const bId = productBrand.get(item.product_id)
      if (!bId) continue
      brandIdsInOrder.add(bId)
      const bucket = buckets.get(bId)
      if (!bucket) continue
      if (createdToday) bucket.total_sales += Number(item.total ?? 0)
    }
    for (const bId of brandIdsInOrder) {
      const bucket = buckets.get(bId)!
      if (createdToday) bucket.orders_today += 1
      if (isPending) bucket.orders_pending += 1
    }
  }

  const by_brand = Array.from(buckets.values())

  res.json({
    metrics: {
      // summed from per-brand buckets; a global order.total would double-count mixed-brand orders
      total_sales_today: by_brand.reduce((s, b) => s + b.total_sales, 0),
      total_orders_today: brandIdFilter
        ? by_brand.reduce((s, b) => s + b.orders_today, 0)
        : totalOrdersToday,
      pending_orders: brandIdFilter
        ? by_brand.reduce((s, b) => s + b.orders_pending, 0)
        : pendingOrders,
      low_stock_products: by_brand.reduce((s, b) => s + b.low_stock_count, 0),
      by_brand,
    },
  })
}
