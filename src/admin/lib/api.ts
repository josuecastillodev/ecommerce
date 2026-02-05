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

/**
 * Create brand
 */
export async function createBrand(data: Partial<Brand>): Promise<Brand> {
  const response = await fetch(`${API_BASE}/brands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || "Failed to create brand")
  }

  const result = await response.json()
  return result.brand
}

/**
 * Update brand
 */
export async function updateBrand(id: string, data: Partial<Brand>): Promise<Brand> {
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
 * Delete brand
 */
export async function deleteBrand(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/brands/${id}`, {
    method: "DELETE",
  })

  if (!response.ok) {
    throw new Error("Failed to delete brand")
  }
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

/**
 * Fetch products with brand filter
 */
export async function fetchProducts(params: {
  brand_id?: string
  limit?: number
  offset?: number
  status?: string
}) {
  const searchParams = new URLSearchParams()

  if (params.brand_id) searchParams.set("brand_id", params.brand_id)
  if (params.limit) searchParams.set("limit", String(params.limit))
  if (params.offset) searchParams.set("offset", String(params.offset))
  if (params.status) searchParams.set("status", params.status)

  const response = await fetch(`${API_BASE}/products?${searchParams}`)

  if (!response.ok) {
    throw new Error("Failed to fetch products")
  }

  return response.json()
}

/**
 * Fetch orders with brand filter
 */
export async function fetchOrders(params: {
  brand_id?: string
  limit?: number
  offset?: number
  status?: string
}) {
  const searchParams = new URLSearchParams()

  if (params.brand_id) searchParams.set("brand_id", params.brand_id)
  if (params.limit) searchParams.set("limit", String(params.limit))
  if (params.offset) searchParams.set("offset", String(params.offset))
  if (params.status) searchParams.set("status", params.status)

  const response = await fetch(`${API_BASE}/orders?${searchParams}`)

  if (!response.ok) {
    throw new Error("Failed to fetch orders")
  }

  return response.json()
}

/**
 * Fetch low stock products
 */
export async function fetchLowStockProducts(brandId?: string, threshold = 10) {
  const params = new URLSearchParams()
  params.set("low_stock", "true")
  params.set("threshold", String(threshold))
  if (brandId) params.set("brand_id", brandId)

  const response = await fetch(`${API_BASE}/products?${params}`)

  if (!response.ok) {
    throw new Error("Failed to fetch low stock products")
  }

  return response.json()
}
