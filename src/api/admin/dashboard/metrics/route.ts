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
import { BigNumber, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { VARIANT_STOCK_FIELDS, calculateTotalStock } from "../../../../modules/product-extension"

const LOW_STOCK_THRESHOLD = 10
const PRODUCT_PAGE_SIZE = 200

type BrandBucket = {
  brand_id: string
  brand_name: string
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

// Suma monetaria precisa: `+=` nativo de JS sobre floats puede acumular error
// en catálogos con muchas líneas. `item.total` puede venir `null`/`NaN` de una
// línea corrupta — BigNumber lanza ante eso, así que se descarta antes (igual
// que el `Number.isFinite` que reemplaza).
function addAmount(current: BigNumber, amount: unknown): BigNumber {
  const n = Number(amount ?? 0)
  if (!Number.isFinite(n)) {
    return current
  }
  return new BigNumber(current.bigNumber!.plus(n))
}

// Todos los productos de la marca/catálogo, en lotes acotados — evita cargar
// el catálogo completo en una sola respuesta de query.graph.
async function fetchAllProducts(
  query: any,
  filters: Record<string, unknown> | undefined
): Promise<any[]> {
  const all: any[] = []
  let skip = 0

  while (true) {
    const { data } = await query.graph({
      entity: "product",
      fields: ["id", "brand.id", ...VARIANT_STOCK_FIELDS],
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
      total_sales: new BigNumber(0),
      orders_today: 0,
      orders_pending: 0,
      products_count: 0,
      low_stock_count: 0,
      currency: "mxn",
    })
  }

  // --- Products + inventory per brand (paginado, no se carga todo de un tirón) ---
  const products = await fetchAllProducts(
    query,
    brandIdFilter ? { brand: { id: brandIdFilter } } : undefined
  )

  const productBrand = new Map<string, string>()
  for (const p of products as any[]) {
    const bId = p.brand?.id
    if (!bId || !buckets.has(bId)) continue
    productBrand.set(p.id, bId)
    const bucket = buckets.get(bId)!
    bucket.products_count += 1
    const stock = calculateTotalStock(p.variants || [])
    if (stock <= LOW_STOCK_THRESHOLD) bucket.low_stock_count += 1
  }

  // --- Orders: dos queries acotadas en la DB en vez de cargar todo el
  // historial y filtrar en JS. "Hoy" y "pendientes" son ventanas acotadas de
  // negocio; el historial completo de órdenes no lo es.
  const today = startOfToday()

  // `total` a nivel de orden se pide aunque no se use: sin un campo de total
  // en la orden, Medusa no dispara el cálculo de totales y `items.total`
  // queda `null` (bug preexistente, no introducido por este cambio —
  // confirmado con un script aislado contra la misma versión de Medusa).
  const { data: todayOrders } = await query.graph({
    entity: "order",
    fields: ["id", "total", "items.product_id", "items.total"],
    filters: { created_at: { $gte: today.toISOString() } },
  })

  const { data: pendingOrdersData } = await query.graph({
    entity: "order",
    fields: ["id", "items.product_id"],
    filters: { status: ["pending", "requires_action"] },
  })

  for (const o of todayOrders as any[]) {
    const brandIdsInOrder = new Set<string>()
    for (const item of o.items || []) {
      const bId = productBrand.get(item.product_id)
      if (!bId) continue
      brandIdsInOrder.add(bId)
      const bucket = buckets.get(bId)
      if (!bucket) continue
      bucket.total_sales = addAmount(bucket.total_sales, item.total)
    }
    for (const bId of brandIdsInOrder) {
      buckets.get(bId)!.orders_today += 1
    }
  }

  for (const o of pendingOrdersData as any[]) {
    const brandIdsInOrder = new Set<string>()
    for (const item of o.items || []) {
      const bId = productBrand.get(item.product_id)
      if (bId) brandIdsInOrder.add(bId)
    }
    for (const bId of brandIdsInOrder) {
      const bucket = buckets.get(bId)
      if (bucket) bucket.orders_pending += 1
    }
  }

  const by_brand = Array.from(buckets.values())
  const totalSalesToday = by_brand.reduce(
    (s, b) => new BigNumber(s.bigNumber!.plus(b.total_sales.bigNumber!)),
    new BigNumber(0)
  )

  res.json({
    metrics: {
      // summed from per-brand buckets; a global order.total would double-count mixed-brand orders
      total_sales_today: totalSalesToday,
      total_orders_today: brandIdFilter
        ? by_brand.reduce((s, b) => s + b.orders_today, 0)
        : todayOrders.length,
      pending_orders: brandIdFilter
        ? by_brand.reduce((s, b) => s + b.orders_pending, 0)
        : pendingOrdersData.length,
      low_stock_products: by_brand.reduce((s, b) => s + b.low_stock_count, 0),
      by_brand,
    },
  })
}
