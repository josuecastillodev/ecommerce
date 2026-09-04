/**
 * Low Stock Alert Widget
 * Shows products with low inventory
 */

import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, Badge, Table, Button } from "@medusajs/ui"
import { useState, useEffect } from "react"
import { useBrands } from "../hooks/use-brand"
import { fetchLowStockProducts } from "../lib/api"

interface LowStockProduct {
  id: string
  title: string
  sku: string
  stock: number
  brand_name: string
  brand_color: string
}

const LOW_STOCK_THRESHOLD = 10

const LowStockAlertWidget = () => {
  const { brands, selectedBrand } = useBrands()
  const [products, setProducts] = useState<LowStockProduct[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    loadLowStockProducts()
  }, [selectedBrand])

  const loadLowStockProducts = async () => {
    setIsLoading(true)
    try {
      const data = await fetchLowStockProducts(selectedBrand?.id, LOW_STOCK_THRESHOLD)
      const rows: LowStockProduct[] = (data.products || []).map((p: any) => ({
        id: p.id,
        title: p.title,
        sku: p.variants?.[0]?.sku ?? "—",
        stock: p.total_stock ?? 0,
        brand_name: p.brand?.name ?? "Sin marca",
        brand_color: p.brand?.primary_color ?? "#888",
      }))
      setProducts(rows)
    } catch (error) {
      console.error("Failed to load low stock products:", error)
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return (
      <Container className="p-4">
        <Text className="text-ui-fg-muted">Cargando...</Text>
      </Container>
    )
  }

  if (products.length === 0) {
    return null
  }

  return (
    <Container className="p-6 mt-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Heading level="h2">Alerta de Stock Bajo</Heading>
          <Badge color="red" size="small">
            {products.length} productos
          </Badge>
        </div>
        <Button variant="secondary" size="small">
          Ver todos
        </Button>
      </div>

      <Text className="text-ui-fg-muted mb-4">
        Productos con menos de {LOW_STOCK_THRESHOLD} unidades en inventario
      </Text>

      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Producto</Table.HeaderCell>
            <Table.HeaderCell>SKU</Table.HeaderCell>
            <Table.HeaderCell>Marca</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Stock</Table.HeaderCell>
            <Table.HeaderCell></Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {products.map((product) => (
            <Table.Row key={product.id}>
              <Table.Cell>
                <Text weight="plus">{product.title}</Text>
              </Table.Cell>
              <Table.Cell>
                <code className="text-xs bg-ui-bg-subtle px-1 py-0.5 rounded">
                  {product.sku}
                </code>
              </Table.Cell>
              <Table.Cell>
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: product.brand_color }}
                  />
                  <Text size="small">{product.brand_name}</Text>
                </div>
              </Table.Cell>
              <Table.Cell className="text-right">
                <Badge
                  color={product.stock <= 3 ? "red" : "orange"}
                  size="small"
                >
                  {product.stock} uds
                </Badge>
              </Table.Cell>
              <Table.Cell>
                <Button variant="secondary" size="small">
                  Reabastecer
                </Button>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.list.after",
})

export default LowStockAlertWidget
