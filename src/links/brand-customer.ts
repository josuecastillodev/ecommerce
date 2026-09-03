import { defineLink } from "@medusajs/framework/utils"
import BrandModule from "../modules/brand"
import CustomerModule from "@medusajs/medusa/customer"

/**
 * Link between Brand and Customer
 * One brand can have many customers
 * A customer belongs to exactly one brand
 */
export default defineLink(
  {
    linkable: BrandModule.linkable.brand,
    isList: false,
  },
  {
    linkable: CustomerModule.linkable.customer,
    isList: true,
  },
  {
    readOnly: false,
  }
)
