/**
 * Create Brand Page
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
  toast,
} from "@medusajs/ui"
import { ArrowLeft } from "@medusajs/icons"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { createBrand } from "../../../lib/api"

const CreateBrandPage = () => {
  const navigate = useNavigate()
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

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
  }

  const handleNameChange = (name: string) => {
    setFormData((prev) => ({
      ...prev,
      name,
      slug: prev.slug || generateSlug(name),
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      await createBrand({
        name: formData.name,
        slug: formData.slug || generateSlug(formData.name),
        description: formData.description || null,
        logo_url: formData.logo_url || null,
        primary_color: formData.primary_color,
        secondary_color: formData.secondary_color,
        active: formData.active,
      })

      toast.success("Marca creada", {
        description: `${formData.name} ha sido creada correctamente`,
      })

      navigate("/brands")
    } catch (error) {
      toast.error("Error", {
        description: error instanceof Error ? error.message : "No se pudo crear la marca",
      })
    } finally {
      setIsSubmitting(false)
    }
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
        <Heading level="h1" className="mb-2">
          Crear nueva marca
        </Heading>
        <Text className="text-ui-fg-muted">
          Configura los detalles de tu nueva marca
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
              onChange={(e) => handleNameChange(e.target.value)}
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
              Se usará en las URLs: /store/urban-street
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
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center font-bold"
                style={{
                  backgroundColor: formData.secondary_color,
                  color: formData.primary_color,
                }}
              >
                {formData.name.charAt(0) || "M"}
              </div>
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
            Crear marca
          </Button>
        </div>
      </form>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Crear marca",
})

export default CreateBrandPage
