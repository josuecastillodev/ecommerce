/**
 * Brand Products Page
 * Shows products filtered by selected brand with full brand context
 */

import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Container,
  Heading,
  Text,
  Button,
  Table,
  Badge,
  Input,
  Select,
  DropdownMenu,
  IconButton,
  toast,
} from "@medusajs/ui"
import { ShoppingBag, Plus, EllipsisHorizontal, PencilSquare, Trash, MagnifyingGlass } from "@medusajs/icons"
import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useBrands } from "../../hooks/use-brand"
import { fetchProducts } from "../../lib/api"

interface ProductVariant {
  id: string
  sku: string
  size: string
  color_name: string
  color_hex: string
  stock: number
  price: number
}

interface Product {
  id: string
  title: string
  slug: string
  thumbnail: string | null
  status: "draft" | "published"
  base_price: number
  brand_id: string
  brand_name: string
  brand_color: string
  total_stock: number
  variants_count: number
  created_at: string
}

const BrandProductsPage = () => {
  const navigate = useNavigate()
  const { brands, selectedBrand, selectBrand } = useBrands()
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [pagination, setPagination] = useState({
    offset: 0,
    limit: 20,
    total: 0,
  })

  useEffect(() => {
    loadProducts()
  }, [selectedBrand, pagination.offset, statusFilter])

  const loadProducts = async () => {
    setIsLoading(true)
    try {
      const params: Record<string, any> = {
        offset: pagination.offset,
        limit: pagination.limit,
      }

      if (selectedBrand) {
        params.brand_id = selectedBrand.id
      }

      if (statusFilter !== "all") {
        params.status = statusFilter
      }

      const data = await fetchProducts(params)

      // Transform data to include brand info
      const transformedProducts = (data.products || []).map((p: any) => ({
        ...p,
        brand_name: brands.find((b) => b.id === p.brand_id)?.name || "Sin marca",
        brand_color: brands.find((b) => b.id === p.brand_id)?.primary_color || "#888",
      }))

      setProducts(transformedProducts)
      setPagination((prev) => ({
        ...prev,
        total: data.count || 0,
      }))
    } catch (error) {
      toast.error("Error", {
        description: "No se pudieron cargar los productos",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const filteredProducts = products.filter((product) =>
    product.title.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
    }).format(price / 100)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("es-MX", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  return (
    <Container className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <Heading level="h1" className="mb-2">
            Productos por Marca
          </Heading>
          <Text className="text-ui-fg-muted">
            {selectedBrand
              ? `Mostrando productos de ${selectedBrand.name}`
              : "Mostrando todos los productos"}
          </Text>
        </div>
        <Button onClick={() => navigate("/products/create")}>
          <Plus className="mr-2" />
          Nuevo producto
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex-1 relative">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-ui-fg-muted" />
          <Input
            placeholder="Buscar productos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

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
          <Select.Trigger className="min-w-[200px]">
            <Select.Value placeholder="Filtrar por marca" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all">Todas las marcas</Select.Item>
            {brands.map((brand) => (
              <Select.Item key={brand.id} value={brand.id}>
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: brand.primary_color }}
                  />
                  {brand.name}
                </div>
              </Select.Item>
            ))}
          </Select.Content>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={setStatusFilter}
        >
          <Select.Trigger className="min-w-[150px]">
            <Select.Value placeholder="Estado" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all">Todos</Select.Item>
            <Select.Item value="published">Publicados</Select.Item>
            <Select.Item value="draft">Borradores</Select.Item>
          </Select.Content>
        </Select>
      </div>

      {/* Products Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Text className="text-ui-fg-muted">Cargando productos...</Text>
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border border-dashed border-ui-border-base rounded-lg">
          <ShoppingBag className="w-12 h-12 text-ui-fg-muted mb-4" />
          <Text className="text-ui-fg-muted mb-4">
            {selectedBrand
              ? `No hay productos para ${selectedBrand.name}`
              : "No hay productos"}
          </Text>
          <Button onClick={() => navigate("/products/create")}>
            <Plus className="mr-2" />
            Crear producto
          </Button>
        </div>
      ) : (
        <>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Producto</Table.HeaderCell>
                <Table.HeaderCell>Marca</Table.HeaderCell>
                <Table.HeaderCell>Precio</Table.HeaderCell>
                <Table.HeaderCell>Variantes</Table.HeaderCell>
                <Table.HeaderCell>Stock</Table.HeaderCell>
                <Table.HeaderCell>Estado</Table.HeaderCell>
                <Table.HeaderCell>Creado</Table.HeaderCell>
                <Table.HeaderCell></Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {filteredProducts.map((product) => (
                <Table.Row
                  key={product.id}
                  className="cursor-pointer hover:bg-ui-bg-subtle"
                  onClick={() => navigate(`/products/${product.id}`)}
                >
                  <Table.Cell>
                    <div className="flex items-center gap-3">
                      {product.thumbnail ? (
                        <img
                          src={product.thumbnail}
                          alt={product.title}
                          className="w-10 h-10 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-ui-bg-subtle flex items-center justify-center">
                          <ShoppingBag className="text-ui-fg-muted" />
                        </div>
                      )}
                      <div>
                        <Text weight="plus">{product.title}</Text>
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {product.slug}
                        </Text>
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: product.brand_color }}
                      />
                      <Text size="small">{product.brand_name}</Text>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Text>{formatPrice(product.base_price)}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge color="grey" size="small">
                      {product.variants_count} variantes
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge
                      color={
                        product.total_stock === 0
                          ? "red"
                          : product.total_stock < 10
                          ? "orange"
                          : "green"
                      }
                      size="small"
                    >
                      {product.total_stock} uds
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge
                      color={product.status === "published" ? "green" : "grey"}
                      size="small"
                    >
                      {product.status === "published" ? "Publicado" : "Borrador"}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" className="text-ui-fg-muted">
                      {formatDate(product.created_at)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <DropdownMenu>
                      <DropdownMenu.Trigger asChild>
                        <IconButton
                          variant="transparent"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <EllipsisHorizontal />
                        </IconButton>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Content>
                        <DropdownMenu.Item
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate(`/products/${product.id}`)
                          }}
                        >
                          <PencilSquare className="mr-2" />
                          Editar
                        </DropdownMenu.Item>
                        <DropdownMenu.Separator />
                        <DropdownMenu.Item
                          className="text-ui-fg-error"
                          onClick={(e) => {
                            e.stopPropagation()
                            // Handle delete
                          }}
                        >
                          <Trash className="mr-2" />
                          Eliminar
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-ui-border-base">
            <Text size="small" className="text-ui-fg-muted">
              Mostrando {filteredProducts.length} de {pagination.total} productos
            </Text>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="small"
                disabled={pagination.offset === 0}
                onClick={() =>
                  setPagination((prev) => ({
                    ...prev,
                    offset: Math.max(0, prev.offset - prev.limit),
                  }))
                }
              >
                Anterior
              </Button>
              <Button
                variant="secondary"
                size="small"
                disabled={pagination.offset + pagination.limit >= pagination.total}
                onClick={() =>
                  setPagination((prev) => ({
                    ...prev,
                    offset: prev.offset + prev.limit,
                  }))
                }
              >
                Siguiente
              </Button>
            </div>
          </div>
        </>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Productos por Marca",
  icon: ShoppingBag,
})

export default BrandProductsPage
