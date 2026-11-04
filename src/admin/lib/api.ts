/**
 * Admin API Functions for Multi-Brand
 */

import type { DashboardMetrics } from "./types"

/**
 * Fetch dashboard metrics
 */
export async function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  const response = await fetch(`/admin/dashboard/metrics`)

  if (!response.ok) {
    throw new Error("Failed to fetch dashboard metrics")
  }

  const data = await response.json()
  return data.metrics
}
