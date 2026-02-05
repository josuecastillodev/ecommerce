/**
 * Category-Product Link
 * Links products to custom categories
 */

import { defineLink } from "@medusajs/framework/utils"
import CategoryModule from "../modules/category"
import ProductModule from "@medusajs/medusa/product"

export default defineLink(
  {
    linkable: CategoryModule.linkable.category,
    isList: false,
  },
  {
    linkable: ProductModule.linkable.product,
    isList: true,
  },
  {
    readOnly: false,
  }
)
