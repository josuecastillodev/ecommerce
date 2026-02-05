import { Module } from "@medusajs/framework/utils"
import CustomerBrandModuleService from "./service"

export const CUSTOMER_BRAND_MODULE = "customerBrandModuleService"

export default Module(CUSTOMER_BRAND_MODULE, {
  service: CustomerBrandModuleService,
})
