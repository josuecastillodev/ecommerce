/**
 * Dashboard Metrics Widget
 * Shows sales, orders, and inventory metrics by brand
 */

import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, Badge, clx } from "@medusajs/ui"
import { useState, useEffect } from "react"
import { useBrands } from "../hooks/use-brand"
import type { BrandStats } from "../lib/types"

interface MetricCardProps {
  title: string
  value: string | number
  subtitle?: string
  trend?: "up" | "down" | "neutral"
  color?: string
}

const MetricCard = ({ title, value, subtitle, trend, color }: MetricCardProps) => (
  <div className="bg-ui-bg-base rounded-lg border border-ui-border-base p-4">
    <Text size="small" className="text-ui-fg-muted mb-1">
      {title}
    </Text>
    <div className="flex items-baseline gap-2">
      <Heading level="h2" className={clx(color && `text-[${color}]`)}>
        {value}
      </Heading>
      {trend && (
        <Badge color={trend === "up" ? "green" : trend === "down" ? "red" : "grey"} size="2xsmall">
          {trend === "up" ? "↑" : trend === "down" ? "↓" : "→"}
        </Badge>
      )}
    </div>
    {subtitle && (
      <Text size="xsmall" className="text-ui-fg-muted mt-1">
        {subtitle}
      </Text>
    )}
  </div>
)

const formatCurrency = (amount: number, currency = "MXN") => {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
  }).format(amount / 100)
}

const DashboardMetricsWidget = () => {
  const { brands, selectedBrand, isLoading: brandsLoading } = useBrands()
  const [metrics, setMetrics] = useState<BrandStats[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    loadMetrics()
  }, [selectedBrand])

  const loadMetrics = async () => {
    setIsLoading(true)
    try {
      // In a real implementation, this would call the metrics API
      // For now, we'll simulate with mock data
      const mockMetrics: BrandStats[] = brands.map((brand) => ({
        brand_id: brand.id,
        brand_name: brand.name,
        total_sales: Math.floor(Math.random() * 10000000),
        orders_today: Math.floor(Math.random() * 50),
        orders_pending: Math.floor(Math.random() * 20),
        products_count: Math.floor(Math.random() * 100) + 10,
        low_stock_count: Math.floor(Math.random() * 10),
        currency: "MXN",
      }))

      if (selectedBrand) {
        setMetrics(mockMetrics.filter((m) => m.brand_id === selectedBrand.id))
      } else {
        setMetrics(mockMetrics)
      }
    } catch (error) {
      console.error("Failed to load metrics:", error)
    } finally {
      setIsLoading(false)
    }
  }

  if (brandsLoading || isLoading) {
    return (
      <Container className="p-6">
        <Text className="text-ui-fg-muted">Cargando métricas...</Text>
      </Container>
    )
  }

  // Calculate totals
  const totals = metrics.reduce(
    (acc, m) => ({
      sales: acc.sales + m.total_sales,
      orders: acc.orders + m.orders_today,
      pending: acc.pending + m.orders_pending,
      lowStock: acc.lowStock + m.low_stock_count,
    }),
    { sales: 0, orders: 0, pending: 0, lowStock: 0 }
  )

  return (
    <Container className="p-6">
      <div className="mb-6">
        <Heading level="h1" className="mb-2">
          Dashboard {selectedBrand ? `- ${selectedBrand.name}` : ""}
        </Heading>
        <Text className="text-ui-fg-muted">
          {selectedBrand
            ? `Métricas de ${selectedBrand.name}`
            : "Métricas globales de todas las marcas"}
        </Text>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard
          title="Ventas del día"
          value={formatCurrency(totals.sales)}
          subtitle="Total en ventas hoy"
          trend="up"
        />
        <MetricCard
          title="Órdenes hoy"
          value={totals.orders}
          subtitle="Nuevas órdenes"
          trend="neutral"
        />
        <MetricCard
          title="Órdenes pendientes"
          value={totals.pending}
          subtitle="Por procesar"
          trend={totals.pending > 10 ? "down" : "neutral"}
        />
        <MetricCard
          title="Bajo stock"
          value={totals.lowStock}
          subtitle="Productos con stock bajo"
          trend={totals.lowStock > 5 ? "down" : "neutral"}
        />
      </div>

      {/* Per-Brand Breakdown (only if viewing all brands) */}
      {!selectedBrand && metrics.length > 1 && (
        <div>
          <Heading level="h2" className="mb-4">
            Por marca
          </Heading>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {metrics.map((brandMetrics) => {
              const brand = brands.find((b) => b.id === brandMetrics.brand_id)
              return (
                <div
                  key={brandMetrics.brand_id}
                  className="bg-ui-bg-subtle rounded-lg border border-ui-border-base p-4"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: brand?.primary_color || "#888" }}
                    />
                    <Heading level="h3">{brandMetrics.brand_name}</Heading>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Text size="xsmall" className="text-ui-fg-muted">
                        Ventas hoy
                      </Text>
                      <Text weight="plus">
                        {formatCurrency(brandMetrics.total_sales, brandMetrics.currency)}
                      </Text>
                    </div>
                    <div>
                      <Text size="xsmall" className="text-ui-fg-muted">
                        Órdenes hoy
                      </Text>
                      <Text weight="plus">{brandMetrics.orders_today}</Text>
                    </div>
                    <div>
                      <Text size="xsmall" className="text-ui-fg-muted">
                        Pendientes
                      </Text>
                      <Text weight="plus" className={brandMetrics.orders_pending > 10 ? "text-ui-fg-error" : ""}>
                        {brandMetrics.orders_pending}
                      </Text>
                    </div>
                    <div>
                      <Text size="xsmall" className="text-ui-fg-muted">
                        Stock bajo
                      </Text>
                      <Text weight="plus" className={brandMetrics.low_stock_count > 5 ? "text-ui-fg-error" : ""}>
                        {brandMetrics.low_stock_count}
                      </Text>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "home.before",
})

export default DashboardMetricsWidget
