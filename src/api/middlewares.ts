import { defineMiddlewares, validateAndTransformBody, validateAndTransformQuery } from "@medusajs/framework/http"
import { z } from "zod"
import { AVAILABLE_SIZES } from "../modules/product-extension"
import { validateCustomerBrand } from "../utils/brand-middleware"

// Medusa's validateAndTransformQuery requires a queryConfig object as its
// second argument. These custom routes run their own query.graph with explicit
// fields, so a minimal list config is all that's needed to avoid the crash.
const LIST_QUERY_CONFIG = { isList: true } as const

// Brand validation schemas
const createBrandSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().min(1, "Slug is required").regex(/^[a-z0-9-]+$/, "Slug must be lowercase with hyphens only"),
  logo_url: z.string().url().optional().nullable(),
  primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color").optional(),
  secondary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color").optional(),
  description: z.string().optional().nullable(),
  active: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
})

const updateBrandSchema = createBrandSchema.partial()

const listBrandsQuerySchema = z.object({
  offset: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  active: z.enum(["true", "false"]).optional(),
  name: z.string().optional(),
})

// Product validation schemas
const colorSchema = z.object({
  name: z.string().min(1),
  hex_code: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
})

const variantSchema = z.object({
  size: z.enum(AVAILABLE_SIZES),
  color: colorSchema,
  stock: z.number().int().min(0),
  price: z.number().positive().optional(),
  sku: z.string().optional(),
})

const createProductSchema = z.object({
  brand_id: z.string().min(1, "Brand ID is required"),
  title: z.string().min(1).max(255),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().max(5000).optional(),
  subtitle: z.string().max(255).optional(),
  handle: z.string().optional(),
  thumbnail: z.string().url().optional(),
  images: z.array(z.string().url()).optional(),
  base_price: z.number().positive("Base price must be greater than 0"),
  currency_code: z.string().length(3).default("MXN"),
  category_ids: z.array(z.string()).optional(),
  variants: z.array(variantSchema).min(1, "At least one variant is required"),
  status: z.enum(["draft", "published"]).default("draft"),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const updateProductSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
  subtitle: z.string().max(255).optional(),
  thumbnail: z.string().url().optional(),
  images: z.array(z.string().url()).optional(),
  base_price: z.number().positive().optional(),
  category_ids: z.array(z.string()).optional(),
  status: z.enum(["draft", "published"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const addVariantSchema = z.object({
  size: z.enum(AVAILABLE_SIZES),
  color: colorSchema,
  stock: z.number().int().min(0),
  price: z.number().positive().optional(),
})

const listProductsQuerySchema = z.object({
  offset: z.coerce.number().min(0).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  brand_id: z.string().optional(),
  category_id: z.string().optional(),
  status: z.enum(["draft", "published", "all"]).optional(),
  min_price: z.coerce.number().min(0).optional(),
  max_price: z.coerce.number().min(0).optional(),
  sizes: z.string().optional(), // comma-separated
  in_stock: z.enum(["true", "false"]).optional(),
})

const storeProductsQuerySchema = listProductsQuerySchema.omit({ status: true })

// Category validation schemas
const createCategorySchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/).max(100).optional(),
  description: z.string().max(1000).nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  brand_id: z.string().nullable().optional(),
  position: z.number().int().min(0).optional(),
  is_active: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
})

const updateCategorySchema = createCategorySchema.partial().omit({ brand_id: true })

const listCategoriesQuerySchema = z.object({
  brand_id: z.string().optional(),
  parent_id: z.string().nullable().optional(),
  is_active: z.enum(["true", "false", "all"]).optional(),
  search: z.string().optional(),
  tree: z.enum(["true", "false"]).default("false"),
  include_global: z.enum(["true", "false"]).default("true"),
  offset: z.coerce.number().min(0).default(0),
  limit: z.coerce.number().min(1).max(100).default(50),
})

const reorderCategoriesSchema = z.object({
  category_ids: z.array(z.string()).min(1),
  parent_id: z.string().nullable().optional(),
})

const moveCategorySchema = z.object({
  new_parent_id: z.string().nullable(),
})

// Per-brand customer preferences (POST /store/customers/me/brand)
const brandPreferencesSchema = z.object({
  marketing_consent: z.boolean().optional(),
  language_preference: z.enum(["es", "en"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export default defineMiddlewares({
  routes: [
    // ==================
    // Admin Brand Routes
    // ==================
    {
      matcher: "/admin/brands",
      method: "POST",
      middlewares: [
        validateAndTransformBody(createBrandSchema),
      ],
    },
    {
      matcher: "/admin/brands",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(listBrandsQuerySchema, LIST_QUERY_CONFIG),
      ],
    },
    {
      matcher: "/admin/brands/:id",
      method: "POST",
      middlewares: [
        validateAndTransformBody(updateBrandSchema),
      ],
    },

    // ====================
    // Admin Product Routes
    // ====================
    {
      matcher: "/admin/products",
      method: "POST",
      middlewares: [
        validateAndTransformBody(createProductSchema),
      ],
    },
    {
      matcher: "/admin/products",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(listProductsQuerySchema, LIST_QUERY_CONFIG),
      ],
    },
    {
      matcher: "/admin/products/:id",
      method: "POST",
      middlewares: [
        validateAndTransformBody(updateProductSchema),
      ],
    },
    {
      matcher: "/admin/products/:id/variants",
      method: "POST",
      middlewares: [
        validateAndTransformBody(addVariantSchema),
      ],
    },

    // ==================
    // Store Brand Routes
    // ==================
    {
      matcher: "/store/brands",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(
          z.object({
            offset: z.coerce.number().optional(),
            limit: z.coerce.number().optional(),
          }), LIST_QUERY_CONFIG),
      ],
    },
    {
      matcher: "/store/brands/:slug/products",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(
          z.object({
            offset: z.coerce.number().optional(),
            limit: z.coerce.number().optional(),
            category_id: z.string().optional(),
            min_price: z.coerce.number().min(0).optional(),
            max_price: z.coerce.number().min(0).optional(),
            sizes: z.string().optional(),
            in_stock: z.enum(["true", "false"]).optional(),
          }), LIST_QUERY_CONFIG),
      ],
    },

    // ====================
    // Store Product Routes
    // ====================
    {
      matcher: "/store/products",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(storeProductsQuerySchema, LIST_QUERY_CONFIG),
      ],
    },

    // ======================
    // Admin Category Routes
    // ======================
    {
      matcher: "/admin/categories",
      method: "POST",
      middlewares: [
        validateAndTransformBody(createCategorySchema),
      ],
    },
    {
      matcher: "/admin/categories",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(listCategoriesQuerySchema, LIST_QUERY_CONFIG),
      ],
    },
    {
      matcher: "/admin/categories/:id",
      method: "POST",
      middlewares: [
        validateAndTransformBody(updateCategorySchema),
      ],
    },
    {
      matcher: "/admin/categories/:id/move",
      method: "POST",
      middlewares: [
        validateAndTransformBody(moveCategorySchema),
      ],
    },
    {
      matcher: "/admin/categories/reorder",
      method: "POST",
      middlewares: [
        validateAndTransformBody(reorderCategoriesSchema),
      ],
    },

    // ======================
    // Store Category Routes
    // ======================
    {
      matcher: "/store/categories",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(listCategoriesQuerySchema, LIST_QUERY_CONFIG),
      ],
    },
    {
      matcher: "/store/categories/:slug/products",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(
          z.object({
            brand_id: z.string().optional(),
            offset: z.coerce.number().min(0).default(0),
            limit: z.coerce.number().min(1).max(100).default(20),
            include_subcategories: z.enum(["true", "false"]).default("true"),
          }), LIST_QUERY_CONFIG),
      ],
    },

    // =======================
    // Store Customer Routes (brand layer over Medusa's native auth)
    // =======================
    // Enforce that the authenticated customer belongs to the brand in the
    // X-Brand-Id header on every authenticated storefront surface.
    {
      matcher: "/store/customers/me",
      middlewares: [validateCustomerBrand()],
    },
    {
      matcher: "/store/customers/me/*",
      middlewares: [validateCustomerBrand()],
    },
    {
      matcher: "/store/orders",
      middlewares: [validateCustomerBrand()],
    },
    {
      matcher: "/store/orders/*",
      middlewares: [validateCustomerBrand()],
    },
    {
      // validateCustomerBrand() already applies via "/store/customers/me/*"
      matcher: "/store/customers/me/brand",
      method: "POST",
      middlewares: [validateAndTransformBody(brandPreferencesSchema)],
    },
  ],
})
