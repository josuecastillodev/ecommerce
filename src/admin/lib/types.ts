/**
 * Admin Types for Multi-Brand Support (marca = sales channel)
 */

export interface BrandStats {
  sales_channel_id: string
  brand_name: string
  brand_color: string
  total_sales: number
  orders_today: number
  orders_pending: number
  products_count: number
  low_stock_count: number
  currency: string
}

export interface DashboardMetrics {
  total_sales_today: number
  total_orders_today: number
  pending_orders: number
  low_stock_products: number
  by_brand: BrandStats[]
}
