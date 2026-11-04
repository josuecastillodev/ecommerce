/**
 * Config de un tenant que empuja el control plane (spec 2026-10-16).
 * `brands` la manda el control plane en cada apply; `initial` solo se usa en
 * el primer apply (ver initial-defaults.ts). Una sola marca lleva `default: true`
 * (spec 2026-10-17).
 */
import { z } from "zod"

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Debe ser un color hex #RRGGBB")

const brandSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug en kebab-case"),
  name: z.string().min(1),
  active: z.boolean().default(true),
  // Marca default: vive en el canal de store.default_sales_channel_id.
  default: z.boolean().default(false),
  // Apariencia: solo se usa al crear la marca; después la edita el cliente.
  description: z.string().nullable().default(null),
  logo_url: z.string().url().nullable().default(null),
  primary_color: hexColor.default("#000000"),
  secondary_color: hexColor.default("#FFFFFF"),
})

const shippingOptionSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(""),
  amount: z.number().nonnegative(),
})

export const TenantConfigSchema = z.object({
  version: z.literal(1),
  store: z.object({ name: z.string().min(1) }),
  brands: z
    .array(brandSchema)
    .refine(
      (brands) => new Set(brands.map((b) => b.slug)).size === brands.length,
      "Los slugs de marca deben ser únicos"
    )
    .refine(
      (brands) => brands.filter((b) => b.default).length === 1,
      "Debe haber exactamente una marca con default: true"
    )
    .refine(
      (brands) => brands.every((b) => !b.default || b.active),
      "La marca default no se puede desactivar"
    ),
  initial: z.object({
    currency: z.string().length(3).toLowerCase(),
    region: z.object({
      name: z.string().min(1),
      countries: z.array(z.string().length(2).toLowerCase()).min(1),
      payment_providers: z.array(z.string().min(1)).min(1),
    }),
    stock_location: z.object({
      name: z.string().min(1),
      address: z.object({
        address_1: z.string().min(1),
        city: z.string().min(1),
        country_code: z.string().length(2).toLowerCase(),
        postal_code: z.string().min(1),
      }),
    }),
    shipping_options: z.array(shippingOptionSchema).min(1),
  }),
})

export type TenantConfig = z.infer<typeof TenantConfigSchema>
export type TenantBrandConfig = TenantConfig["brands"][number]
