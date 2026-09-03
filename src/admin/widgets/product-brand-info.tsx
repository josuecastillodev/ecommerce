/**
 * Product Brand Info Widget
 * Shows brand information on product detail page
 */

import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, Badge, Button } from "@medusajs/ui"
import { BuildingStorefront, ArrowUpRightMini } from "@medusajs/icons"
import { useState, useEffect } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useBrands } from "../hooks/use-brand"

interface ProductDetailProps {
  data?: {
    id: string
    metadata?: {
      brand_id?: string
    }
  }
}

const ProductBrandInfoWidget = ({ data }: ProductDetailProps) => {
  const navigate = useNavigate()
  const { brands, isLoading } = useBrands()
  const [productBrand, setProductBrand] = useState<any>(null)

  useEffect(() => {
    if (data?.metadata?.brand_id && brands.length > 0) {
      const brand = brands.find((b) => b.id === data.metadata?.brand_id)
      setProductBrand(brand || null)
    }
  }, [data, brands])

  if (isLoading) {
    return (
      <Container className="p-6">
        <Text className="text-ui-fg-muted">Cargando información de marca...</Text>
      </Container>
    )
  }

  if (!productBrand) {
    return (
      <Container className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <BuildingStorefront className="text-ui-fg-muted" />
          <Heading level="h2">Marca del producto</Heading>
        </div>
        <div className="p-4 bg-ui-bg-subtle rounded-lg border border-dashed border-ui-border-base">
          <Text className="text-ui-fg-muted text-center">
            Este producto no tiene marca asignada
          </Text>
        </div>
      </Container>
    )
  }

  return (
    <Container className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <BuildingStorefront className="text-ui-fg-muted" />
          <Heading level="h2">Marca del producto</Heading>
        </div>
        <Button
          variant="transparent"
          size="small"
          onClick={() => navigate(`/brands/${productBrand.id}`)}
        >
          Ver marca
          <ArrowUpRightMini className="ml-1" />
        </Button>
      </div>

      <div
        className="p-4 rounded-lg flex items-center gap-4"
        style={{ backgroundColor: productBrand.primary_color }}
      >
        {productBrand.logo_url ? (
          <img
            src={productBrand.logo_url}
            alt={productBrand.name}
            className="w-12 h-12 rounded-lg object-cover bg-white"
          />
        ) : (
          <div
            className="w-12 h-12 rounded-lg flex items-center justify-center text-xl font-bold"
            style={{
              backgroundColor: productBrand.secondary_color,
              color: productBrand.primary_color,
            }}
          >
            {productBrand.name.charAt(0)}
          </div>
        )}

        <div className="flex-1">
          <Text
            weight="plus"
            className="text-lg"
            style={{ color: productBrand.secondary_color }}
          >
            {productBrand.name}
          </Text>
          <Text
            size="small"
            style={{ color: productBrand.secondary_color, opacity: 0.8 }}
          >
            {productBrand.slug}
          </Text>
        </div>

        <Badge color={productBrand.active ? "green" : "grey"}>
          {productBrand.active ? "Activa" : "Inactiva"}
        </Badge>
      </div>

      {productBrand.description && (
        <Text size="small" className="text-ui-fg-muted mt-3">
          {productBrand.description}
        </Text>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.before",
})

export default ProductBrandInfoWidget
