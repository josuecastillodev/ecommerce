import { defineLink } from "@medusajs/framework/utils"
import BrandModule from "../modules/brand"
import SalesChannelModule from "@medusajs/medusa/sales-channel"

/**
 * Link Brand <-> SalesChannel (1:1)
 * Cada marca tiene exactamente un sales channel; ese canal es lo que aísla
 * el catálogo y el carrito por storefront (tenancy nativa de Medusa).
 */
export default defineLink(
  {
    linkable: BrandModule.linkable.brand,
    isList: false,
  },
  {
    linkable: SalesChannelModule.linkable.salesChannel,
    isList: false,
  },
  {
    readOnly: false,
  }
)
