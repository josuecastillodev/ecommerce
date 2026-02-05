/**
 * Edit Brand Page
 */

import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Container,
  Heading,
  Text,
  Button,
  Input,
  Label,
  Textarea,
  Switch,
  Badge,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { ArrowLeft, Trash } from "@medusajs/icons"
import { useState, useEffect } from "react"
import { useNavigate, useParams } from "react-router-dom"
import type { Brand } from "../../../lib/types"
import { fetchBrand, updateBrand, deleteBrand } from "../../../lib/api"

const EditBrandPage = () => {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const prompt = usePrompt()

  const [brand, setBrand] = useState<Brand | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    description: "",
    logo_url: "",
    primary_color: "#1A1A1A",
    secondary_color: "#FFFFFF",
    active: true,
  })

  useEffect(() => {
    if (id) {
      loadBrand(id)
    }
  }, [id])

  const loadBrand = async (brandId: string) => {
    setIsLoading(true)
    try {
      const data = await fetchBrand(brandId)
      setBrand(data)
      setFormData({
        name: data.name,
        slug: data.slug,
        description: data.description || "",
        logo_url: data.logo_url || "",
        primary_color: data.primary_color,
        secondary_color: data.secondary_color,
        active: data.active,
      })
    } catch (error) {
      toast.error("Error", {
        description: "No se pudo cargar la marca",
      })
      navigate("/brands")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id) return

    setIsSubmitting(true)

    try {
      await updateBrand(id, {
        name: formData.name,
        slug: formData.slug,
        description: formData.description || null,
        logo_url: formData.logo_url || null,
        primary_color: formData.primary_color,
        secondary_color: formData.secondary_color,
        active: formData.active,
      })

      toast.success("Marca actualizada", {
        description: `${formData.name} ha sido actualizada correctamente`,
      })

      navigate("/brands")
    } catch (error) {
      toast.error("Error", {
        description: error instanceof Error ? error.message : "No se pudo actualizar la marca",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!brand) return

    const confirmed = await prompt({
      title: "Eliminar marca",
      description: `¿Estás seguro de que deseas eliminar "${brand.name}"? Esta acción no se puede deshacer y eliminará todos los productos asociados.`,
      confirmText: "Eliminar",
      cancelText: "Cancelar",
    })

    if (confirmed) {
      try {
        await deleteBrand(brand.id)
        toast.success("Marca eliminada", {
          description: `${brand.name} ha sido eliminada correctamente`,
        })
        navigate("/brands")
      } catch (error) {
        toast.error("Error", {
          description: "No se pudo eliminar la marca",
        })
      }
    }
  }

  if (isLoading) {
    return (
      <Container className="p-8 flex items-center justify-center">
        <Text className="text-ui-fg-muted">Cargando marca...</Text>
      </Container>
    )
  }

  if (!brand) {
    return (
      <Container className="p-8 flex items-center justify-center">
        <Text className="text-ui-fg-muted">Marca no encontrada</Text>
      </Container>
    )
  }

  return (
    <Container className="p-8 max-w-2xl">
      {/* Header */}
      <div className="mb-8">
        <Button
          variant="transparent"
          className="mb-4"
          onClick={() => navigate("/brands")}
        >
          <ArrowLeft className="mr-2" />
          Volver a marcas
        </Button>
        <div className="flex items-center gap-3 mb-2">
          <Heading level="h1">Editar marca</Heading>
          <Badge color={brand.active ? "green" : "grey"}>
            {brand.active ? "Activa" : "Inactiva"}
          </Badge>
        </div>
        <Text className="text-ui-fg-muted">
          Actualiza los detalles de {brand.name}
        </Text>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <div className="bg-ui-bg-base rounded-lg border border-ui-border-base p-6 space-y-4">
          <Heading level="h2" className="mb-4">
            Información básica
          </Heading>

          <div>
            <Label htmlFor="name">Nombre de la marca *</Label>
            <Input
              id="name"
              placeholder="Ej: Urban Street"
              value={formData.name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
              required
            />
          </div>

          <div>
            <Label htmlFor="slug">Slug (URL)</Label>
            <Input
              id="slug"
              placeholder="urban-street"
              value={formData.slug}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, slug: e.target.value }))
              }
            />
            <Text size="xsmall" className="text-ui-fg-muted mt-1">
              Se usará en las URLs: /store/{formData.slug}
            </Text>
          </div>

          <div>
            <Label htmlFor="description">Descripción</Label>
            <Textarea
              id="description"
              placeholder="Describe tu marca..."
              value={formData.description}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, description: e.target.value }))
              }
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="logo_url">URL del logo</Label>
            <Input
              id="logo_url"
              type="url"
              placeholder="https://..."
              value={formData.logo_url}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, logo_url: e.target.value }))
              }
            />
            {formData.logo_url && (
              <img
                src={formData.logo_url}
                alt="Logo preview"
                className="mt-2 w-20 h-20 rounded-lg object-cover border border-ui-border-base"
              />
            )}
          </div>
        </div>

        {/* Colors */}
        <div className="bg-ui-bg-base rounded-lg border border-ui-border-base p-6 space-y-4">
          <Heading level="h2" className="mb-4">
            Colores de marca
          </Heading>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="primary_color">Color primario</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  id="primary_color"
                  value={formData.primary_color}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, primary_color: e.target.value }))
                  }
                  className="w-12 h-10 rounded border border-ui-border-base cursor-pointer"
                />
                <Input
                  value={formData.primary_color}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, primary_color: e.target.value }))
                  }
                  placeholder="#1A1A1A"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="secondary_color">Color secundario</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  id="secondary_color"
                  value={formData.secondary_color}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, secondary_color: e.target.value }))
                  }
                  className="w-12 h-10 rounded border border-ui-border-base cursor-pointer"
                />
                <Input
                  value={formData.secondary_color}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, secondary_color: e.target.value }))
                  }
                  placeholder="#FFFFFF"
                />
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="mt-4">
            <Label>Vista previa</Label>
            <div
              className="mt-2 p-4 rounded-lg flex items-center gap-3"
              style={{ backgroundColor: formData.primary_color }}
            >
              {formData.logo_url ? (
                <img
                  src={formData.logo_url}
                  alt={formData.name}
                  className="w-10 h-10 rounded-lg object-cover"
                />
              ) : (
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center font-bold"
                  style={{
                    backgroundColor: formData.secondary_color,
                    color: formData.primary_color,
                  }}
                >
                  {formData.name.charAt(0) || "M"}
                </div>
              )}
              <Text
                weight="plus"
                style={{ color: formData.secondary_color }}
              >
                {formData.name || "Nombre de marca"}
              </Text>
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="bg-ui-bg-base rounded-lg border border-ui-border-base p-6">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="active">Marca activa</Label>
              <Text size="small" className="text-ui-fg-muted">
                Las marcas inactivas no se mostrarán en el storefront
              </Text>
            </div>
            <Switch
              id="active"
              checked={formData.active}
              onCheckedChange={(checked) =>
                setFormData((prev) => ({ ...prev, active: checked }))
              }
            />
          </div>
        </div>

        {/* Danger Zone */}
        <div className="bg-ui-bg-base rounded-lg border border-ui-tag-red-border p-6">
          <Heading level="h2" className="text-ui-fg-error mb-2">
            Zona de peligro
          </Heading>
          <Text size="small" className="text-ui-fg-muted mb-4">
            Eliminar esta marca eliminará permanentemente todos sus datos asociados.
          </Text>
          <Button variant="danger" type="button" onClick={handleDelete}>
            <Trash className="mr-2" />
            Eliminar marca
          </Button>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate("/brands")}
          >
            Cancelar
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            Guardar cambios
          </Button>
        </div>
      </form>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Editar marca",
})

export default EditBrandPage
