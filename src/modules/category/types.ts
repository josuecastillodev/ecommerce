/**
 * Category Types
 * Type definitions for category module
 */

export interface CategoryDTO {
  id: string
  name: string
  slug: string
  description: string | null
  image_url: string | null
  parent_id: string | null
  brand_id: string | null
  position: number
  is_active: boolean
  metadata: Record<string, unknown> | null
  created_at: Date
  updated_at: Date
}

export interface CategoryWithChildren extends CategoryDTO {
  children: CategoryDTO[]
}

export interface CreateCategoryInput {
  name: string
  slug?: string
  description?: string | null
  image_url?: string | null
  parent_id?: string | null
  brand_id?: string | null
  position?: number
  is_active?: boolean
  metadata?: Record<string, unknown> | null
}

export interface UpdateCategoryInput {
  id: string
  name?: string
  slug?: string
  description?: string | null
  image_url?: string | null
  parent_id?: string | null
  position?: number
  is_active?: boolean
  metadata?: Record<string, unknown> | null
}

export interface CategoryFilters {
  brand_id?: string | null
  parent_id?: string | null
  is_active?: boolean
  slug?: string
}

export interface ReorderCategoriesInput {
  category_ids: string[]
  parent_id?: string | null
}

export interface MoveCategoryInput {
  category_id: string
  new_parent_id: string | null
}
