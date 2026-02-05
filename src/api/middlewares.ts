import { defineMiddlewares, validateAndTransformBody, validateAndTransformQuery } from "@medusajs/framework/http"
import { z } from "zod"
import { AVAILABLE_SIZES } from "../modules/product-extension"

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
  metadata: z.record(z.unknown()).optional(),
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
  metadata: z.record(z.unknown()).optional(),
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
  metadata: z.record(z.unknown()).nullable().optional(),
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

// Payment validation schemas
const createPaymentIntentSchema = z.object({
  cart_id: z.string().min(1, "Cart ID is required"),
  payment_method_type: z.enum(["card", "oxxo"]).default("card"),
  customer_email: z.string().email().optional(),
  customer_name: z.string().optional(),
})

const paymentMethodsQuerySchema = z.object({
  amount: z.coerce.number().min(0).optional(),
})

// Customer validation schemas
const customerRegistrationSchema = z.object({
  email: z.string().email("El email debe ser válido").min(1, "El email es requerido"),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "La contraseña debe contener al menos una mayúscula, una minúscula y un número"
    ),
  first_name: z
    .string()
    .min(2, "El nombre debe tener al menos 2 caracteres")
    .max(100, "El nombre no puede exceder 100 caracteres"),
  last_name: z
    .string()
    .min(2, "El apellido debe tener al menos 2 caracteres")
    .max(100, "El apellido no puede exceder 100 caracteres"),
  phone: z
    .string()
    .regex(/^\+?[1-9]\d{9,14}$/, "El teléfono debe ser válido (ej: +525512345678)")
    .optional(),
  brand_id: z.string().min(1, "El brand_id es requerido"),
  marketing_consent: z.boolean().optional().default(false),
})

const customerLoginSchema = z.object({
  email: z.string().email("El email debe ser válido").min(1, "El email es requerido"),
  password: z.string().min(1, "La contraseña es requerida"),
  brand_id: z.string().min(1, "El brand_id es requerido"),
})

const updateCustomerProfileSchema = z.object({
  first_name: z
    .string()
    .min(2, "El nombre debe tener al menos 2 caracteres")
    .max(100, "El nombre no puede exceder 100 caracteres")
    .optional(),
  last_name: z
    .string()
    .min(2, "El apellido debe tener al menos 2 caracteres")
    .max(100, "El apellido no puede exceder 100 caracteres")
    .optional(),
  phone: z
    .string()
    .regex(/^\+?[1-9]\d{9,14}$/, "El teléfono debe ser válido")
    .nullable()
    .optional(),
  marketing_consent: z.boolean().optional(),
  language_preference: z.enum(["es", "en"]).optional(),
  metadata: z.record(z.unknown()).optional(),
})

const createAddressSchema = z.object({
  first_name: z
    .string()
    .min(2, "El nombre debe tener al menos 2 caracteres")
    .max(100, "El nombre no puede exceder 100 caracteres"),
  last_name: z
    .string()
    .min(2, "El apellido debe tener al menos 2 caracteres")
    .max(100, "El apellido no puede exceder 100 caracteres"),
  address_1: z
    .string()
    .min(5, "La dirección debe tener al menos 5 caracteres")
    .max(255, "La dirección no puede exceder 255 caracteres"),
  address_2: z.string().max(255).optional(),
  city: z
    .string()
    .min(2, "La ciudad debe tener al menos 2 caracteres")
    .max(100, "La ciudad no puede exceder 100 caracteres"),
  province: z.string().max(100).optional(),
  postal_code: z.string().regex(/^\d{5}$/, "El código postal debe tener 5 dígitos"),
  country_code: z.string().length(2).default("MX"),
  phone: z
    .string()
    .regex(/^\+?[1-9]\d{9,14}$/, "El teléfono debe ser válido")
    .optional(),
  company: z.string().max(100).optional(),
  is_default_shipping: z.boolean().optional().default(false),
  is_default_billing: z.boolean().optional().default(false),
  metadata: z.record(z.unknown()).optional(),
})

const updateAddressSchema = createAddressSchema.partial()

const bulkUpdateAddressesSchema = z.object({
  addresses: z.array(
    z.object({
      id: z.string().min(1),
      first_name: z.string().min(2).max(100).optional(),
      last_name: z.string().min(2).max(100).optional(),
      address_1: z.string().min(5).max(255).optional(),
      address_2: z.string().max(255).nullable().optional(),
      city: z.string().min(2).max(100).optional(),
      province: z.string().max(100).nullable().optional(),
      postal_code: z.string().regex(/^\d{5}$/).optional(),
      country_code: z.string().length(2).optional(),
      phone: z.string().regex(/^\+?[1-9]\d{9,14}$/).nullable().optional(),
      company: z.string().max(100).nullable().optional(),
      is_default_shipping: z.boolean().optional(),
      is_default_billing: z.boolean().optional(),
      metadata: z.record(z.unknown()).optional(),
    })
  ).min(1, "Se requiere al menos una dirección"),
})

const listCustomersQuerySchema = z.object({
  offset: z.coerce.number().min(0).default(0),
  limit: z.coerce.number().min(1).max(100).default(20),
})

const listOrdersQuerySchema = z.object({
  offset: z.coerce.number().min(0).default(0),
  limit: z.coerce.number().min(1).max(50).default(10),
  status: z.string().optional(),
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
        validateAndTransformQuery(listProductsQuerySchema),
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
            min_price: z.coerce.number().min(0).optional(),
            max_price: z.coerce.number().min(0).optional(),
            sizes: z.string().optional(),
            in_stock: z.enum(["true", "false"]).optional(),
          })
        ),
      ],
    },

    // ====================
    // Store Product Routes
    // ====================
    {
      matcher: "/store/products",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(storeProductsQuerySchema),
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
        validateAndTransformQuery(listCategoriesQuerySchema),
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
        validateAndTransformQuery(listCategoriesQuerySchema),
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
          })
        ),
      ],
    },

    // ======================
    // Store Payment Routes
    // ======================
    {
      matcher: "/store/payments/stripe",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(paymentMethodsQuerySchema),
      ],
    },
    {
      matcher: "/store/payments/stripe",
      method: "POST",
      middlewares: [
        validateAndTransformBody(createPaymentIntentSchema),
      ],
    },

    // =======================
    // Store Customer Routes
    // =======================
    {
      matcher: "/store/customers",
      method: "POST",
      middlewares: [
        validateAndTransformBody(customerRegistrationSchema),
      ],
    },
    {
      matcher: "/store/customers",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(listCustomersQuerySchema),
      ],
    },
    {
      matcher: "/store/auth",
      method: "POST",
      middlewares: [
        validateAndTransformBody(customerLoginSchema),
      ],
    },
    {
      matcher: "/store/customers/me",
      method: "PUT",
      middlewares: [
        validateAndTransformBody(updateCustomerProfileSchema),
      ],
    },
    {
      matcher: "/store/customers/me/addresses",
      method: "POST",
      middlewares: [
        validateAndTransformBody(createAddressSchema),
      ],
    },
    {
      matcher: "/store/customers/me/addresses",
      method: "PUT",
      middlewares: [
        validateAndTransformBody(bulkUpdateAddressesSchema),
      ],
    },
    {
      matcher: "/store/customers/me/addresses/:id",
      method: "PUT",
      middlewares: [
        validateAndTransformBody(updateAddressSchema),
      ],
    },
    {
      matcher: "/store/customers/me/orders",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(listOrdersQuerySchema),
      ],
    },
  ],
})
