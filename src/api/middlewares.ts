import { defineMiddlewares, validateAndTransformBody, validateAndTransformQuery } from "@medusajs/framework/http"
import { z } from "zod"
import { requireControlPlaneToken } from "../utils/control-plane-auth"
import {
  validateCustomerBrand,
  validateCartLineItemBrand,
  validateCartCreateBrand,
  guardSalesChannelProducts,
} from "../utils/brand-middleware"

// Medusa's validateAndTransformQuery requires a queryConfig object as its
// second argument. These custom routes run their own query.graph with explicit
// fields, so a minimal list config is all that's needed to avoid the crash.
const LIST_QUERY_CONFIG = { isList: true } as const

// Brand validation schemas. Estructura de marca (nombre, slug, activa) la
// manda el control plane vía /internal/tenant/apply; en el admin solo se
// edita la apariencia (spec 2026-10-16).
const updateBrandAppearanceSchema = z
  .object({
    logo_url: z.string().url().optional().nullable(),
    primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color").optional(),
    secondary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color").optional(),
    description: z.string().optional().nullable(),
  })
  .strict()

const listBrandsQuerySchema = z.object({
  offset: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  active: z.enum(["true", "false"]).optional(),
  name: z.string().optional(),
})

// Category validation schemas
const createCategorySchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/).max(100).optional(),
  description: z.string().max(1000).nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  sales_channel_id: z.string().nullable().optional(),
  position: z.number().int().min(0).optional(),
  is_active: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
})

const updateCategorySchema = createCategorySchema.partial().omit({ sales_channel_id: true })

const listCategoriesQuerySchema = z.object({
  sales_channel_id: z.string().optional(),
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
      method: "GET",
      middlewares: [
        validateAndTransformQuery(listBrandsQuerySchema, LIST_QUERY_CONFIG),
      ],
    },
    {
      matcher: "/admin/brands/:id",
      method: "POST",
      middlewares: [
        validateAndTransformBody(updateBrandAppearanceSchema),
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

    // ==================
    // Admin Product Routes (marca = sales channel, spec 2026-10-17)
    // ==================
    // Crear/editar productos usa las rutas nativas; la regla "un producto, un
    // canal" vive en src/workflows/hooks/product-single-channel.ts. Esta ruta
    // nativa no tiene hook, así que se guarda aquí.
    {
      matcher: "/admin/sales-channels/:id/products",
      method: "POST",
      middlewares: [guardSalesChannelProducts()],
    },

    // ==================
    // Store Cart Routes (brand guard — Medusa 2.20 no valida el sales channel
    // de la variante en el carrito)
    // ==================
    {
      matcher: "/store/carts",
      method: "POST",
      middlewares: [validateCartCreateBrand()],
    },
    {
      matcher: "/store/carts/:id/line-items",
      method: "POST",
      middlewares: [validateCartLineItemBrand()],
    },
    {
      matcher: "/store/carts/:id/complete",
      method: "POST",
      middlewares: [validateCartLineItemBrand()],
    },
    // ==================
    // Internal (control plane) — Bearer CONTROL_PLANE_TOKEN
    // ==================
    {
      matcher: "/internal/tenant/apply",
      method: "POST",
      middlewares: [requireControlPlaneToken()],
    },
  ],
})
