export interface BrandDTO {
  id: string
  name: string
  slug: string
  logo_url: string | null
  primary_color: string
  secondary_color: string
  description: string | null
  active: boolean
  metadata: Record<string, unknown> | null
  created_at: Date
  updated_at: Date
}

export interface CreateBrandDTO {
  name: string
  slug: string
  logo_url?: string | null
  primary_color?: string
  secondary_color?: string
  description?: string | null
  active?: boolean
  metadata?: Record<string, unknown> | null
}

export interface UpdateBrandDTO {
  id: string
  name?: string
  slug?: string
  logo_url?: string | null
  primary_color?: string
  secondary_color?: string
  description?: string | null
  active?: boolean
  metadata?: Record<string, unknown> | null
}

export interface FilterableBrandProps {
  id?: string | string[]
  name?: string
  slug?: string
  active?: boolean
}
