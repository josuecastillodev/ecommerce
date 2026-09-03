/**
 * Order Brand Filter Widget
 * Shows active brand filter indicator on order list
 */

import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Badge, Text, Button } from "@medusajs/ui"
import { XMark, Funnel } from "@medusajs/icons"
import { useBrands } from "../hooks/use-brand"

const OrderBrandFilterWidget = () => {
  const { selectedBrand, selectBrand } = useBrands()

  if (!selectedBrand) {
    return null
  }

  return (
    <Container className="mb-4">
      <div className="flex items-center justify-between p-4 bg-ui-bg-subtle rounded-lg border border-ui-border-base">
        <div className="flex items-center gap-3">
          <Funnel className="text-ui-fg-muted" />
          <Text size="small" className="text-ui-fg-muted">
            Filtrando pedidos por marca:
          </Text>
          <Badge size="small">
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: selectedBrand.primary_color }}
              />
              <span>{selectedBrand.name}</span>
            </div>
          </Badge>
        </div>
        <Button
          variant="transparent"
          size="small"
          onClick={() => selectBrand(null)}
        >
          <XMark className="mr-1" />
          Quitar filtro
        </Button>
      </div>
      <Text size="xsmall" className="text-ui-fg-muted mt-2">
        Solo se muestran pedidos que contienen productos de {selectedBrand.name}.
      </Text>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.list.before",
})

export default OrderBrandFilterWidget
