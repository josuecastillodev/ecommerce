import { model } from "@medusajs/framework/utils"

export const Brand = model.define("brand", {
  id: model.id().primaryKey(),
  name: model.text().searchable(),
  slug: model.text().unique(),
  logo_url: model.text().nullable(),
  primary_color: model.text().default("#000000"),
  secondary_color: model.text().default("#FFFFFF"),
  description: model.text().nullable(),
  active: model.boolean().default(true),
  metadata: model.json().nullable(),
})
