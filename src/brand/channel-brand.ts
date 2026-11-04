/**
 * Marca = sales channel (spec 2026-10-17). La identidad y la apariencia viven
 * en `metadata` con claves planas `brand_*`, editables en el admin nativo.
 * Solo lectura: no toca la DB.
 */
import type { TenantBrandConfig } from "../tenant/config-schema"

export const BRAND_METADATA_KEYS = {
  slug: "brand_slug",
  logo_url: "brand_logo_url",
  primary_color: "brand_primary_color",
  secondary_color: "brand_secondary_color",
} as const

export const BRAND_CHANNEL_FIELDS = ["id", "name", "description", "is_disabled", "metadata"]

export type BrandChannel = {
  id: string
  name: string
  description: string | null
  is_disabled: boolean
  metadata: Record<string, unknown> | null
}

export type ChannelBrand = {
  sales_channel_id: string
  slug: string
  name: string
  description: string | null
  active: boolean
  logo_url: string | null
  primary_color: string
  secondary_color: string
}

const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null)

export function brandFromChannel(ch: BrandChannel): ChannelBrand | null {
  const md = ch.metadata ?? {}
  const slug = str(md[BRAND_METADATA_KEYS.slug])
  if (!slug) return null
  return {
    sales_channel_id: ch.id,
    slug,
    name: ch.name,
    description: ch.description ?? null,
    active: !ch.is_disabled,
    logo_url: str(md[BRAND_METADATA_KEYS.logo_url]),
    primary_color: str(md[BRAND_METADATA_KEYS.primary_color]) ?? "#000000",
    secondary_color: str(md[BRAND_METADATA_KEYS.secondary_color]) ?? "#FFFFFF",
  }
}

export function brandMetadata(
  cfg: Pick<TenantBrandConfig, "slug" | "logo_url" | "primary_color" | "secondary_color">
): Record<string, string> {
  return {
    [BRAND_METADATA_KEYS.slug]: cfg.slug,
    [BRAND_METADATA_KEYS.logo_url]: cfg.logo_url ?? "",
    [BRAND_METADATA_KEYS.primary_color]: cfg.primary_color,
    [BRAND_METADATA_KEYS.secondary_color]: cfg.secondary_color,
  }
}
