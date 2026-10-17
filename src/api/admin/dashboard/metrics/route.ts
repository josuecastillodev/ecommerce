/**
 * Admin Dashboard Metrics
 * GET /admin/dashboard/metrics?sales_channel_id=<opcional>
 *
 * Marca = sales channel (spec 2026-10-17):
 *  - products_count / low_stock_count: product.sales_channels + niveles de inventario
 *  - orders_today / orders_pending / total_sales: order.sales_channel_id (nativo y
 *    directo; el guard de carrito impide pedidos con varias marcas)
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BigNumber, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { VARIANT_STOCK_FIELDS, calculateTotalStock } from "../../../../modules/product-extension"
import { BRAND_CHANNEL_FIELDS, brandFromChannel, type BrandChannel } from "../../../../brand/channel-brand"

const LOW_STOCK_THRESHOLD = 10
const PRODUCT_PAGE_SIZE = 200

type BrandBucket = {
  sales_channel_id: string
  brand_name: string
  brand_color: string
  total_sales: BigNumber
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

// Suma monetaria precisa; descarta montos null/NaN de una orden corrupta.
function addAmount(current: BigNumber, amount: unknown): BigNumber {
  const n = Number(amount ?? 0)
  if (!Number.isFinite(n)) {
    return current
  }
  return new BigNumber(current.bigNumber!.plus(n))
}

// Todos los productos, en lotes acotados.
async function fetchAllProducts(query: any, filters: Record<string, unknown> | undefined): Promise<any[]> {
  const all: any[] = []
  let skip = 0
  while (true) {
    const { data } = await query.graph({
      entity: "product",
      fields: ["id", "sales_channels.id", ...VARIANT_STOCK_FIELDS],
      ...(filters ? { filters } : {}),
      pagination: { take: PRODUCT_PAGE_SIZE, skip },
    })
    all.push(...data)
    if (data.length < PRODUCT_PAGE_SIZE) {
      break
    }
    skip += PRODUCT_PAGE_SIZE
  }
  return all
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const channelFilter = (req.query.sales_channel_id as string) || undefined

  const { data: channelRows } = await query.graph({
    entity: "sales_channel",
    fields: BRAND_CHANNEL_FIELDS,
    ...(channelFilter ? { filters: { id: channelFilter } } : {}),
  })

  const buckets = new Map<string, BrandBucket>()
  for (const ch of channelRows as unknown as BrandChannel[]) {
    const brand = brandFromChannel(ch)
    if (!brand) continue
    buckets.set(ch.id, {
      sales_channel_id: ch.id,
      brand_name: brand.name,
      brand_color: brand.primary_color,
      total_sales: new BigNumber(0),
      orders_today: 0,
      orders_pending: 0,
      products_count: 0,
      low_stock_count: 0,
      currency: "mxn",
    })
  }

  const products = await fetchAllProducts(
    query,
    channelFilter ? { sales_channels: { id: channelFilter } } : undefined
  )
  for (const p of products as any[]) {
    const bucket = buckets.get(p.sales_channels?.[0]?.id)
    if (!bucket) continue
    bucket.products_count += 1
    if (calculateTotalStock(p.variants || []) <= LOW_STOCK_THRESHOLD) bucket.low_stock_count += 1
  }

  const orderScope = channelFilter ? { sales_channel_id: channelFilter } : {}
  const { data: todayOrders } = await query.graph({
    entity: "order",
    fields: ["id", "total", "sales_channel_id"],
    filters: { ...orderScope, created_at: { $gte: startOfToday().toISOString() } },
  })
  const { data: pendingOrders } = await query.graph({
    entity: "order",
    fields: ["id", "sales_channel_id"],
    filters: { ...orderScope, status: ["pending", "requires_action"] },
  })

  for (const o of todayOrders as any[]) {
    const bucket = buckets.get(o.sales_channel_id)
    if (!bucket) continue
    bucket.orders_today += 1
    bucket.total_sales = addAmount(bucket.total_sales, o.total)
  }
  for (const o of pendingOrders as any[]) {
    const bucket = buckets.get(o.sales_channel_id)
    if (bucket) bucket.orders_pending += 1
  }

  const by_brand = Array.from(buckets.values())
  res.json({
    metrics: {
      total_sales_today: by_brand.reduce(
        (s, b) => new BigNumber(s.bigNumber!.plus(b.total_sales.bigNumber!)),
        new BigNumber(0)
      ),
      total_orders_today: by_brand.reduce((s, b) => s + b.orders_today, 0),
      pending_orders: by_brand.reduce((s, b) => s + b.orders_pending, 0),
      low_stock_products: by_brand.reduce((s, b) => s + b.low_stock_count, 0),
      by_brand,
    },
  })
}
