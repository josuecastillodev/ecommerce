/**
 * Brand Selector Widget
 * Displays in the admin header for switching between brands
 */

import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Select, Badge, Text } from "@medusajs/ui"
import { useBrands } from "../hooks/use-brand"

const BrandSelectorWidget = () => {
  const { brands, selectedBrand, isLoading, selectBrand } = useBrands()

  if (isLoading) {
    return (
      <Container className="flex items-center gap-2 px-3 py-2">
        <Text size="small" className="text-ui-fg-muted">
          Cargando marcas...
        </Text>
      </Container>
    )
  }

  if (brands.length === 0) {
    return null
  }

  return (
    <Container className="flex items-center gap-3 px-3 py-2 bg-ui-bg-subtle rounded-lg border border-ui-border-base">
      <Text size="small" weight="plus" className="text-ui-fg-muted whitespace-nowrap">
        Marca:
      </Text>
      <Select
        value={selectedBrand?.id || "all"}
        onValueChange={(value) => {
          if (value === "all") {
            selectBrand(null)
          } else {
            const brand = brands.find((b) => b.id === value)
            if (brand) selectBrand(brand)
          }
        }}
      >
        <Select.Trigger className="min-w-[180px]">
          <Select.Value placeholder="Seleccionar marca">
            {selectedBrand ? (
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: selectedBrand.primary_color }}
                />
                <span>{selectedBrand.name}</span>
              </div>
            ) : (
              <span>Todas las marcas</span>
            )}
          </Select.Value>
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="all">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-ui-fg-muted" />
              <span>Todas las marcas</span>
            </div>
          </Select.Item>
          {brands.map((brand) => (
            <Select.Item key={brand.id} value={brand.id}>
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: brand.primary_color }}
                />
                <span>{brand.name}</span>
                {!brand.active && (
                  <Badge color="grey" size="2xsmall">
                    Inactiva
                  </Badge>
                )}
              </div>
            </Select.Item>
          ))}
        </Select.Content>
      </Select>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "nav.top.before",
})

export default BrandSelectorWidget
