/**
 * Admin API Functions for Multi-Brand
 */

import type { Brand, DashboardMetrics } from "./types"

const API_BASE = "/admin"

/**
 * Fetch all brands
 */
export async function fetchBrands(): Promise<Brand[]> {
  const response = await fetch(`${API_BASE}/brands`)

  if (!response.ok) {
    throw new Error("Failed to fetch brands")
  }

  const data = await response.json()
  return data.brands
}

/**
 * Fetch single brand
 */
export async function fetchBrand(id: string): Promise<Brand> {
  const response = await fetch(`${API_BASE}/brands/${id}`)

  if (!response.ok) {
    throw new Error("Failed to fetch brand")
  }

  const data = await response.json()
  return data.brand
}

export type BrandAppearance = Partial<
  Pick<Brand, "logo_url" | "primary_color" | "secondary_color" | "description">
>

/**
 * Update brand appearance (name/slug/active come from the control plane)
 */
export async function updateBrand(id: string, data: BrandAppearance): Promise<Brand> {
  const response = await fetch(`${API_BASE}/brands/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || "Failed to update brand")
  }

  const result = await response.json()
  return result.brand
}

/**
 * Fetch dashboard metrics
 */
export async function fetchDashboardMetrics(brandId?: string): Promise<DashboardMetrics> {
  const params = brandId ? `?brand_id=${brandId}` : ""
  const response = await fetch(`${API_BASE}/dashboard/metrics${params}`)

  if (!response.ok) {
    throw new Error("Failed to fetch dashboard metrics")
  }

  const data = await response.json()
  return data.metrics
}
