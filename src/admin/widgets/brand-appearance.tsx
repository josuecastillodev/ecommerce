/**
 * Apariencia de la marca en la pantalla nativa del sales channel: descripción,
 * logo y colores. Guarda por la ruta nativa POST /admin/sales-channels/:id; el
 * nombre, el estado y el slug los gestiona el control plane.
 */
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { DetailWidgetProps, AdminSalesChannel } from "@medusajs/framework/types"
import { Button, Container, Heading, Input, Label, Text, Textarea, toast } from "@medusajs/ui"
import { useState } from "react"

const KEYS = {
  slug: "brand_slug",
  logo_url: "brand_logo_url",
  primary_color: "brand_primary_color",
  secondary_color: "brand_secondary_color",
} as const

const BrandAppearanceWidget = ({ data: channel }: DetailWidgetProps<AdminSalesChannel>) => {
  const md = (channel.metadata ?? {}) as Record<string, string>
  const [form, setForm] = useState({
    description: channel.description ?? "",
    logo_url: md[KEYS.logo_url] ?? "",
    primary_color: md[KEYS.primary_color] || "#000000",
    secondary_color: md[KEYS.secondary_color] || "#FFFFFF",
  })
  const [saving, setSaving] = useState(false)

  if (!md[KEYS.slug]) {
    return null
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const save = async () => {
    setSaving(true)
    try {
      const response = await fetch(`/admin/sales-channels/${channel.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: form.description || null,
          metadata: {
            ...md,
            [KEYS.logo_url]: form.logo_url,
            [KEYS.primary_color]: form.primary_color,
            [KEYS.secondary_color]: form.secondary_color,
          },
        }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.message || "No se pudo guardar la apariencia.")
      }
      toast.success("Apariencia guardada")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar la apariencia.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Container className="p-6 space-y-4">
      <div>
        <Heading level="h2">Apariencia de la marca</Heading>
        <Text size="small" className="text-ui-fg-muted">
          Nombre, slug y estado se gestionan desde el control plane del tenant.
        </Text>
      </div>
      <div>
        <Label htmlFor="brand-description">Descripción</Label>
        <Textarea id="brand-description" rows={3} value={form.description} onChange={set("description")} />
      </div>
      <div>
        <Label htmlFor="brand-logo">URL del logo</Label>
        <Input id="brand-logo" type="url" placeholder="https://..." value={form.logo_url} onChange={set("logo_url")} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        {(["primary_color", "secondary_color"] as const).map((key) => (
          <div key={key}>
            <Label htmlFor={`brand-${key}`}>{key === "primary_color" ? "Color primario" : "Color secundario"}</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label={key === "primary_color" ? "Selector de color primario" : "Selector de color secundario"}
                value={form[key]}
                onChange={set(key)}
                className="w-12 h-10 rounded border border-ui-border-base cursor-pointer"
              />
              <Input id={`brand-${key}`} value={form[key]} onChange={set(key)} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button onClick={save} isLoading={saving}>
          Guardar apariencia
        </Button>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "sales_channel.details.after",
})

export default BrandAppearanceWidget
