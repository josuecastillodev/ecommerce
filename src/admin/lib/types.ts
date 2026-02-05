/**
 * Admin Types for Multi-Brand Support
 */

export interface Brand {
  id: string
  name: string
  slug: string
  logo_url: string | null
  primary_color: string
  secondary_color: string
  description: string | null
  active: boolean
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface BrandStats {
  brand_id: string
  brand_name: string
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

export interface BrandContextValue {
  selectedBrand: Brand | null
  brands: Brand[]
  isLoading: boolean
  error: string | null
  selectBrand: (brand: Brand | null) => void
  refreshBrands: () => Promise<void>
}

export const BRAND_STORAGE_KEY = "medusa_admin_selected_brand"
