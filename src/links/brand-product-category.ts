import { defineLink } from "@medusajs/framework/utils"
import BrandModule from "../modules/brand"
import ProductModule from "@medusajs/medusa/product"

export default defineLink(
  {
    linkable: BrandModule.linkable.brand,
    isList: false,
  },
  {
    linkable: ProductModule.linkable.productCategory,
    isList: true,
  },
  {
    readOnly: false,
  }
)
