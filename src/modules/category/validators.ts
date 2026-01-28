/**
 * Category Validation Schemas
 * Zod schemas for category validation
 */

import { z } from "zod"

// Helper to generate slug from name
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

// Create category schema
export const createCategorySchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be 100 characters or less"),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, "Slug must contain only lowercase letters, numbers, and hyphens")
    .max(100)
    .optional(),
  description: z
    .string()
    .max(1000, "Description must be 1000 characters or less")
    .nullable()
    .optional(),
  image_url: z
    .string()
    .url("Image URL must be a valid URL")
    .nullable()
    .optional(),
  parent_id: z
    .string()
    .nullable()
    .optional(),
  brand_id: z
    .string()
    .nullable()
    .optional(),
  position: z
    .number()
    .int()
    .min(0)
    .optional(),
  is_active: z
    .boolean()
    .default(true),
  metadata: z
    .record(z.unknown())
    .nullable()
    .optional(),
})

// Update category schema
export const updateCategorySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .optional(),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(100)
    .optional(),
  description: z
    .string()
    .max(1000)
    .nullable()
    .optional(),
  image_url: z
    .string()
    .url()
    .nullable()
    .optional(),
  parent_id: z
    .string()
    .nullable()
    .optional(),
  position: z
    .number()
    .int()
    .min(0)
    .optional(),
  is_active: z
    .boolean()
    .optional(),
  metadata: z
    .record(z.unknown())
    .nullable()
    .optional(),
})

// List categories query schema
export const listCategoriesQuerySchema = z.object({
  brand_id: z.string().optional(),
  parent_id: z.string().nullable().optional(),
  is_active: z.enum(["true", "false"]).optional(),
  include_global: z.enum(["true", "false"]).default("true"),
  tree: z.enum(["true", "false"]).default("false"),
  offset: z.coerce.number().min(0).default(0),
  limit: z.coerce.number().min(1).max(100).default(50),
})

// Reorder categories schema
export const reorderCategoriesSchema = z.object({
  category_ids: z
    .array(z.string())
    .min(1, "At least one category ID is required"),
  parent_id: z
    .string()
    .nullable()
    .optional(),
})

// Move category schema
export const moveCategorySchema = z.object({
  new_parent_id: z.string().nullable(),
})

// Category filters for admin
export const adminCategoryFiltersSchema = z.object({
  brand_id: z.string().optional(),
  parent_id: z.string().nullable().optional(),
  is_active: z.enum(["true", "false", "all"]).optional(),
  search: z.string().optional(),
  tree: z.enum(["true", "false"]).default("false"),
  offset: z.coerce.number().min(0).default(0),
  limit: z.coerce.number().min(1).max(100).default(50),
})

export const categoryValidators = {
  createCategory: createCategorySchema,
  updateCategory: updateCategorySchema,
  listCategoriesQuery: listCategoriesQuerySchema,
  reorderCategories: reorderCategoriesSchema,
  moveCategory: moveCategorySchema,
  adminCategoryFilters: adminCategoryFiltersSchema,
}

// Type exports
export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>
export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesSchema>
export type MoveCategoryInput = z.infer<typeof moveCategorySchema>
export type AdminCategoryFilters = z.infer<typeof adminCategoryFiltersSchema>
