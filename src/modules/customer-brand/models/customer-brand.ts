import { model } from "@medusajs/framework/utils"

/**
 * CustomerBrand Model
 * Associates customers with a specific brand
 * A customer belongs to exactly one brand and cannot purchase from other brands
 */
export const CustomerBrand = model.define("customer_brand", {
  id: model.id().primaryKey(),
  customer_id: model.text().unique(),
  brand_id: model.text(),
  // Registration source tracking
  registered_from: model.text().default("storefront"), // storefront, admin, api
  // Additional customer preferences per brand
  marketing_consent: model.boolean().default(false),
  language_preference: model.text().default("es"),
  metadata: model.json().nullable(),
})
