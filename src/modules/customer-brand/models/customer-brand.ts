import { model } from "@medusajs/framework/utils"

/**
 * CustomerBrand Model
 * Associates customers with a brand (its sales channel)
 * A customer belongs to exactly one brand and cannot purchase from other brands
 */
export const CustomerBrand = model.define("customer_brand", {
  id: model.id().primaryKey(),
  customer_id: model.text().unique(),
  sales_channel_id: model.text(), // marca = sales channel (spec 2026-10-17)
  // Registration source tracking
  registered_from: model.text().default("storefront"), // storefront, admin, api
  // Additional customer preferences per brand
  marketing_consent: model.boolean().default(false),
  language_preference: model.text().default("es"),
  metadata: model.json().nullable(),
})
