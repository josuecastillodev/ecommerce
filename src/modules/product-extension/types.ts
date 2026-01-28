/**
 * Product Extension Types
 * Types for extended product functionality with brand support
 */

// Available sizes for clothing products
export const AVAILABLE_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const
export type Size = (typeof AVAILABLE_SIZES)[number]

// Color definition
export interface ProductColor {
  name: string      // e.g., "Negro", "Blanco"
  hex_code: string  // e.g., "#000000"
}

// Variant input for creating products
export interface VariantInput {
  size: Size
  color: ProductColor
  stock: number
  price?: number  // Optional override price, uses base price if not provided
  sku?: string    // Optional manual SKU, auto-generated if not provided
}

// Product creation input with brand
export interface CreateProductWithBrandInput {
  brand_id: string
  title: string
  slug?: string
  description?: string
  subtitle?: string
  handle?: string
  thumbnail?: string
  images?: string[]
  base_price: number
  currency_code?: string  // Default: MXN
  category_ids?: string[]
  variants: VariantInput[]
  status?: "draft" | "published"
  metadata?: Record<string, unknown>
}

// Product update input
export interface UpdateProductWithBrandInput {
  id: string
  title?: string
  description?: string
  subtitle?: string
  thumbnail?: string
  images?: string[]
  base_price?: number
  category_ids?: string[]
  status?: "draft" | "published"
  metadata?: Record<string, unknown>
}

// Variant creation input for existing product
export interface AddVariantInput {
  product_id: string
  brand_id: string
  size: Size
  color: ProductColor
  stock: number
  price?: number
}

// SKU generation input
export interface SKUGenerationInput {
  brand_slug: string
  product_slug: string
  size: Size
  color_name: string
}

// Product query filters
export interface ProductQueryFilters {
  brand_id?: string
  category_id?: string
  status?: "draft" | "published"
  min_price?: number
  max_price?: number
  sizes?: Size[]
  in_stock?: boolean
}

// Paginated response
export interface PaginatedProductsResponse {
  products: unknown[]
  count: number
  offset: number
  limit: number
}
