import { Module } from "@medusajs/framework/utils"
import CategoryModuleService from "./service"

export const CATEGORY_MODULE = "categoryModuleService"

export default Module(CATEGORY_MODULE, {
  service: CategoryModuleService,
})
