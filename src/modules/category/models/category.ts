/**
 * Category Entity
 * Hierarchical categories with optional brand association
 */

import { model } from "@medusajs/framework/utils"

export const Category = model.define("category", {
  id: model.id().primaryKey(),
  name: model.text().searchable(),
  slug: model.text(),
  description: model.text().nullable(),
  image_url: model.text().nullable(),
  parent_id: model.text().nullable(),
  brand_id: model.text().nullable(), // null = global category
  position: model.number().default(0),
  is_active: model.boolean().default(true),
  metadata: model.json().nullable(),
})
  .indexes([
    {
      on: ["slug", "brand_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      on: ["parent_id"],
    },
    {
      on: ["brand_id"],
    },
    {
      on: ["position"],
    },
  ])
