import { defineMiddlewares, validateAndTransformBody, validateAndTransformQuery } from "@medusajs/framework/http"
import { z } from "zod"

// Brand validation schemas
const createBrandSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().min(1, "Slug is required").regex(/^[a-z0-9-]+$/, "Slug must be lowercase with hyphens only"),
  logo_url: z.string().url().optional().nullable(),
  primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color").optional(),
  secondary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color").optional(),
  description: z.string().optional().nullable(),
  active: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional().nullable(),
})

const updateBrandSchema = createBrandSchema.partial()

const listBrandsQuerySchema = z.object({
  offset: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  active: z.enum(["true", "false"]).optional(),
  name: z.string().optional(),
})

export default defineMiddlewares({
  routes: [
    // Admin brand routes
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
        validateAndTransformQuery(listBrandsQuerySchema),
      ],
    },
    {
      matcher: "/admin/brands/:id",
      method: "POST",
      middlewares: [
        validateAndTransformBody(updateBrandSchema),
      ],
    },
    // Store brand routes
    {
      matcher: "/store/brands",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(
          z.object({
            offset: z.coerce.number().optional(),
            limit: z.coerce.number().optional(),
          })
        ),
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
          })
        ),
      ],
    },
  ],
})
