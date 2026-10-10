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

/**
 * Product as returned by GET /admin/brand-products (query.graph product +
 * computed fields). Only the fields the admin UI reads are typed.
 */
export interface BrandProductVariant {
  id: string
  title: string | null
  sku: string | null
  prices?: { amount: number; currency_code: string }[]
}

export interface BrandProduct {
  id: string
  title: string
  handle: string
  thumbnail: string | null
  status: "draft" | "proposed" | "published" | "rejected"
  metadata: { brand_id?: string; [key: string]: unknown } | null
  created_at: string
  updated_at: string
  variants: BrandProductVariant[]
  brand: Pick<Brand, "id" | "name" | "slug" | "primary_color"> | null
  // computed by the route
  price_range: { min: number; max: number } | null
  total_stock: number
  variant_count: number
  in_stock: boolean
}

export interface BrandProductListResponse {
  products: BrandProduct[]
  count: number
  offset: number
  limit: number
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
