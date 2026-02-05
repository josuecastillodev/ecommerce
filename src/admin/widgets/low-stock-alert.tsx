/**
 * Low Stock Alert Widget
 * Shows products with low inventory
 */

import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, Badge, Table, Button } from "@medusajs/ui"
import { useState, useEffect } from "react"
import { useBrands } from "../hooks/use-brand"

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
      // Mock data - in real implementation, call API
      const mockProducts: LowStockProduct[] = [
        {
          id: "1",
          title: "Camiseta Grafitti - M/Negro",
          sku: "urban-street-camiseta-grafitti-M-negro",
          stock: 3,
          brand_name: "Urban Street",
          brand_color: "#1A1A1A",
        },
        {
          id: "2",
          title: "Polo Ejecutivo - L/Azul",
          sku: "classic-threads-polo-ejecutivo-L-azul-marino",
          stock: 5,
          brand_name: "Classic Threads",
          brand_color: "#2C3E50",
        },
        {
          id: "3",
          title: "T-Shirt Neon Dreams - XL/Negro",
          sku: "urban-street-t-shirt-neon-dreams-XL-negro",
          stock: 2,
          brand_name: "Urban Street",
          brand_color: "#1A1A1A",
        },
        {
          id: "4",
          title: "Henley Casual - S/Beige",
          sku: "classic-threads-henley-casual-S-beige",
          stock: 8,
          brand_name: "Classic Threads",
          brand_color: "#2C3E50",
        },
      ]

      // Filter by selected brand if any
      let filtered = mockProducts
      if (selectedBrand) {
        filtered = mockProducts.filter(
          (p) => p.brand_name === selectedBrand.name
        )
      }

      setProducts(filtered.filter((p) => p.stock <= LOW_STOCK_THRESHOLD))
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
  zone: "home.after",
})

export default LowStockAlertWidget
