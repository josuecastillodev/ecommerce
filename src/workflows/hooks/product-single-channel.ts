/**
 * Valida la regla "un producto, un canal" en los hooks nativos. Medusa liga los
 * canales antes de ejecutar estos hooks, y si el hook lanza, revierte la
 * creación o la edición. Cubre el form del admin, POST /admin/products, el
 * batch y la importación CSV.
 */
import { createProductsWorkflow, updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { assertProductsInOneChannel } from "../../brand/product-channel-rule"

createProductsWorkflow.hooks.productsCreated(async ({ products }, { container }) => {
  await assertProductsInOneChannel(container, products.map((p) => p.id))
})

updateProductsWorkflow.hooks.productsUpdated(async ({ products }, { container }) => {
  await assertProductsInOneChannel(container, products.map((p) => p.id))
})
