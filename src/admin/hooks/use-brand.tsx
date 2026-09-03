/**
 * Brand Selection Hook
 * Manages selected brand state across the admin dashboard
 */

import { useState, useEffect, useCallback } from "react"
import type { Brand } from "../lib/types"
import { BRAND_STORAGE_KEY } from "../lib/types"
import { fetchBrands } from "../lib/api"

export function useBrands() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load brands on mount
  useEffect(() => {
    loadBrands()
  }, [])

  // Load saved brand selection from localStorage
  useEffect(() => {
    if (brands.length > 0) {
      const savedBrandId = localStorage.getItem(BRAND_STORAGE_KEY)
      if (savedBrandId) {
        const savedBrand = brands.find((b) => b.id === savedBrandId)
        if (savedBrand) {
          setSelectedBrand(savedBrand)
        }
      }
    }
  }, [brands])

  const loadBrands = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const data = await fetchBrands()
      setBrands(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load brands")
    } finally {
      setIsLoading(false)
    }
  }

  const selectBrand = useCallback((brand: Brand | null) => {
    setSelectedBrand(brand)
    if (brand) {
      localStorage.setItem(BRAND_STORAGE_KEY, brand.id)
    } else {
      localStorage.removeItem(BRAND_STORAGE_KEY)
    }
  }, [])

  const refreshBrands = useCallback(async () => {
    await loadBrands()
  }, [])

  return {
    brands,
    selectedBrand,
    isLoading,
    error,
    selectBrand,
    refreshBrands,
  }
}

/**
 * Hook to get filtered query params based on selected brand
 */
export function useBrandFilter(selectedBrand: Brand | null) {
  const getFilterParams = useCallback(
    (additionalParams?: Record<string, string>) => {
      const params: Record<string, string> = { ...additionalParams }

      if (selectedBrand) {
        params.brand_id = selectedBrand.id
      }

      return params
    },
    [selectedBrand]
  )

  return { getFilterParams, brandId: selectedBrand?.id }
}
