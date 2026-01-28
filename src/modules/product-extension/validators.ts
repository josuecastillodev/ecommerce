/**
 * Product Validation Schemas
 * Zod schemas for product and variant validation
 */

import { z } from "zod"
import { AVAILABLE_SIZES } from "./types"

// Color schema
const colorSchema = z.object({
  name: z
    .string()
    .min(1, "Color name is required")
    .max(50, "Color name must be 50 characters or less"),
  hex_code: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color code (must be #RRGGBB format)"),
})

// Variant schema
const variantSchema = z.object({
  size: z.enum(AVAILABLE_SIZES, {
    errorMap: () => ({
      message: `Size must be one of: ${AVAILABLE_SIZES.join(", ")}`,
    }),
  }),
  color: colorSchema,
  stock: z
    .number()
    .int("Stock must be an integer")
    .min(0, "Stock cannot be negative"),
  price: z
    .number()
    .positive("Price must be greater than 0")
    .optional(),
  sku: z
    .string()
    .min(1)
    .max(100)
    .optional(),
})

// Create product schema
const createProductSchema = z.object({
  brand_id: z
    .string()
    .min(1, "Brand ID is required"),
  title: z
    .string()
    .min(1, "Title is required")
    .max(255, "Title must be 255 characters or less"),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, "Slug must contain only lowercase letters, numbers, and hyphens")
    .optional(),
  description: z
    .string()
    .max(5000, "Description must be 5000 characters or less")
    .optional(),
  subtitle: z
    .string()
    .max(255, "Subtitle must be 255 characters or less")
    .optional(),
  handle: z
    .string()
    .max(255)
    .optional(),
  thumbnail: z
    .string()
    .url("Thumbnail must be a valid URL")
    .optional(),
  images: z
    .array(z.string().url("Each image must be a valid URL"))
    .optional(),
  base_price: z
    .number()
    .positive("Base price must be greater than 0"),
  currency_code: z
    .string()
    .length(3, "Currency code must be 3 characters")
    .default("MXN"),
  category_ids: z
    .array(z.string())
    .optional(),
  variants: z
    .array(variantSchema)
    .min(1, "Product must have at least one variant"),
  status: z
    .enum(["draft", "published"])
    .default("draft"),
  metadata: z
    .record(z.unknown())
    .optional(),
})

// Update product schema
const updateProductSchema = z.object({
  id: z.string().min(1, "Product ID is required"),
  title: z
    .string()
    .min(1)
    .max(255)
    .optional(),
  description: z
    .string()
    .max(5000)
    .optional(),
  subtitle: z
    .string()
    .max(255)
    .optional(),
  thumbnail: z
    .string()
    .url()
    .optional(),
  images: z
    .array(z.string().url())
    .optional(),
  base_price: z
    .number()
    .positive("Base price must be greater than 0")
    .optional(),
  category_ids: z
    .array(z.string())
    .optional(),
  status: z
    .enum(["draft", "published"])
    .optional(),
  metadata: z
    .record(z.unknown())
    .optional(),
})

// Add variant schema
const addVariantSchema = z.object({
  product_id: z.string().min(1, "Product ID is required"),
  brand_id: z.string().min(1, "Brand ID is required"),
  size: z.enum(AVAILABLE_SIZES),
  color: colorSchema,
  stock: z.number().int().min(0),
  price: z.number().positive().optional(),
})

// Update variant schema
const updateVariantSchema = z.object({
  id: z.string().min(1, "Variant ID is required"),
  stock: z.number().int().min(0).optional(),
  price: z.number().positive().optional(),
})

// Query filters schema
const productFiltersSchema = z.object({
  brand_id: z.string().optional(),
  category_id: z.string().optional(),
  status: z.enum(["draft", "published"]).optional(),
  min_price: z.number().min(0).optional(),
  max_price: z.number().min(0).optional(),
  sizes: z.array(z.enum(AVAILABLE_SIZES)).optional(),
  in_stock: z.boolean().optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(20),
})

// Admin product filters (includes all statuses)
const adminProductFiltersSchema = productFiltersSchema.extend({
  status: z.enum(["draft", "published", "all"]).optional(),
})

export const productValidators = {
  createProduct: createProductSchema,
  updateProduct: updateProductSchema,
  addVariant: addVariantSchema,
  updateVariant: updateVariantSchema,
  productFilters: productFiltersSchema,
  adminProductFilters: adminProductFiltersSchema,
  color: colorSchema,
  variant: variantSchema,
}

// Type exports from schemas
export type CreateProductInput = z.infer<typeof createProductSchema>
export type UpdateProductInput = z.infer<typeof updateProductSchema>
export type AddVariantInput = z.infer<typeof addVariantSchema>
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>
export type ProductFiltersInput = z.infer<typeof productFiltersSchema>
export type AdminProductFiltersInput = z.infer<typeof adminProductFiltersSchema>
