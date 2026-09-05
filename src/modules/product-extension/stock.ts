/**
 * Stock Calculation Helper
 *
 * Available stock is `stocked_quantity - reserved_quantity` summed across a
 * variant's inventory locations. `variants.inventory_quantity` is NOT
 * populated by `query.graph` in this Medusa version and always reads as
 * `undefined`/0 — routes that read it silently report stock 0. Always fetch
 * `variants.inventory_items.inventory.location_levels.{stocked_quantity,reserved_quantity}`
 * (see `VARIANT_STOCK_FIELDS`) and compute through this helper instead.
 */

// query.graph `fields` entries required for `calculateVariantStock` /
// `calculateTotalStock` to work. Spread these into a product/variant query.
export const VARIANT_STOCK_FIELDS = [
  "variants.inventory_items.inventory.location_levels.stocked_quantity",
  "variants.inventory_items.inventory.location_levels.reserved_quantity",
] as const

interface LocationLevel {
  stocked_quantity?: number | null
  reserved_quantity?: number | null
}

interface InventoryItem {
  inventory?: {
    location_levels?: LocationLevel[] | null
  } | null
}

interface VariantWithInventory {
  inventory_items?: InventoryItem[] | null
}

/** Available stock for a single variant, summed across all its locations. */
export function calculateVariantStock(variant: VariantWithInventory): number {
  const levels =
    variant.inventory_items?.flatMap(
      (item) => item.inventory?.location_levels ?? []
    ) ?? []

  return levels.reduce(
    (sum, level) =>
      sum + ((level.stocked_quantity ?? 0) - (level.reserved_quantity ?? 0)),
    0
  )
}

/** Available stock for a product, summed across all its variants. */
export function calculateTotalStock(variants: VariantWithInventory[]): number {
  return variants.reduce((sum, variant) => sum + calculateVariantStock(variant), 0)
}
