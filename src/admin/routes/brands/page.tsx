/**
 * Brands Management Page
 * CRUD interface for managing brands
 */

import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Container,
  Heading,
  Text,
  Table,
  Badge,
  DropdownMenu,
  IconButton,
  toast,
} from "@medusajs/ui"
import { EllipsisHorizontal, PencilSquare, BuildingStorefront } from "@medusajs/icons"
import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import type { Brand } from "../../lib/types"
import { fetchBrands } from "../../lib/api"

const BrandsPage = () => {
  const [brands, setBrands] = useState<Brand[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    loadBrands()
  }, [])

  const loadBrands = async () => {
    setIsLoading(true)
    try {
      const data = await fetchBrands()
      setBrands(data)
    } catch (error) {
      toast.error("Error", {
        description: "No se pudieron cargar las marcas",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Container className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <Heading level="h1" className="mb-2">
            Gestión de Marcas
          </Heading>
          <Text className="text-ui-fg-muted">
            Administra las marcas de tu tienda multi-marca
          </Text>
        </div>
      </div>

      {/* Brands Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Text className="text-ui-fg-muted">Cargando marcas...</Text>
        </div>
      ) : brands.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 bg-ui-bg-subtle rounded-lg border border-ui-border-base">
          <BuildingStorefront className="w-12 h-12 text-ui-fg-muted mb-4" />
          <Heading level="h2" className="mb-2">
            No hay marcas
          </Heading>
          <Text size="small" className="text-ui-fg-muted">
            Las marcas se dan de alta desde el control plane del tenant.
          </Text>
        </div>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Marca</Table.HeaderCell>
              <Table.HeaderCell>Slug</Table.HeaderCell>
              <Table.HeaderCell>Colores</Table.HeaderCell>
              <Table.HeaderCell>Estado</Table.HeaderCell>
              <Table.HeaderCell>Creada</Table.HeaderCell>
              <Table.HeaderCell className="w-[50px]"></Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {brands.map((brand) => (
              <Table.Row
                key={brand.id}
                className="cursor-pointer hover:bg-ui-bg-subtle-hover"
                onClick={() => navigate(`/brands/${brand.id}`)}
              >
                <Table.Cell>
                  <div className="flex items-center gap-3">
                    {brand.logo_url ? (
                      <img
                        src={brand.logo_url}
                        alt={brand.name}
                        className="w-10 h-10 rounded-lg object-cover"
                      />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold"
                        style={{ backgroundColor: brand.primary_color }}
                      >
                        {brand.name.charAt(0)}
                      </div>
                    )}
                    <div>
                      <Text weight="plus">{brand.name}</Text>
                      {brand.description && (
                        <Text size="xsmall" className="text-ui-fg-muted line-clamp-1">
                          {brand.description}
                        </Text>
                      )}
                    </div>
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <code className="text-xs bg-ui-bg-subtle px-2 py-1 rounded">
                    {brand.slug}
                  </code>
                </Table.Cell>
                <Table.Cell>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-6 h-6 rounded border border-ui-border-base"
                      style={{ backgroundColor: brand.primary_color }}
                      title={`Primario: ${brand.primary_color}`}
                    />
                    <div
                      className="w-6 h-6 rounded border border-ui-border-base"
                      style={{ backgroundColor: brand.secondary_color }}
                      title={`Secundario: ${brand.secondary_color}`}
                    />
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <Badge color={brand.active ? "green" : "grey"}>
                    {brand.active ? "Activa" : "Inactiva"}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  <Text size="small" className="text-ui-fg-muted">
                    {new Date(brand.created_at).toLocaleDateString("es-MX")}
                  </Text>
                </Table.Cell>
                <Table.Cell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenu.Trigger asChild>
                      <IconButton variant="transparent">
                        <EllipsisHorizontal />
                      </IconButton>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content>
                      <DropdownMenu.Item onClick={() => navigate(`/brands/${brand.id}`)}>
                        <PencilSquare className="mr-2" />
                        Editar
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Marcas",
  icon: BuildingStorefront,
})

export default BrandsPage
