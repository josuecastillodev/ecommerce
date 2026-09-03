/**
 * Brand Context Provider
 * Provides brand selection state across the admin dashboard
 */

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react"
import type { Brand } from "../lib/types"
import { BRAND_STORAGE_KEY } from "../lib/types"
import { fetchBrands } from "../lib/api"

interface BrandContextType {
  brands: Brand[]
  selectedBrand: Brand | null
  isLoading: boolean
  error: string | null
  selectBrand: (brand: Brand | null) => void
  refreshBrands: () => Promise<void>
}

const BrandContext = createContext<BrandContextType | undefined>(undefined)

interface BrandProviderProps {
  children: ReactNode
}

export function BrandProvider({ children }: BrandProviderProps) {
  const [brands, setBrands] = useState<Brand[]>([])
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  const selectBrand = useCallback((brand: Brand | null) => {
    setSelectedBrand(brand)
    if (brand) {
      localStorage.setItem(BRAND_STORAGE_KEY, brand.id)
    } else {
      localStorage.removeItem(BRAND_STORAGE_KEY)
    }
    // Dispatch custom event for other components to react
    window.dispatchEvent(new CustomEvent("brand-changed", { detail: brand }))
  }, [])

  const refreshBrands = useCallback(async () => {
    await loadBrands()
  }, [])

  return (
    <BrandContext.Provider
      value={{
        brands,
        selectedBrand,
        isLoading,
        error,
        selectBrand,
        refreshBrands,
      }}
    >
      {children}
    </BrandContext.Provider>
  )
}

export function useBrandContext() {
  const context = useContext(BrandContext)
  if (context === undefined) {
    throw new Error("useBrandContext must be used within a BrandProvider")
  }
  return context
}

/**
 * Hook to listen for brand changes across the app
 */
export function useBrandChangeListener(callback: (brand: Brand | null) => void) {
  useEffect(() => {
    const handler = (event: CustomEvent<Brand | null>) => {
      callback(event.detail)
    }

    window.addEventListener("brand-changed", handler as EventListener)
    return () => {
      window.removeEventListener("brand-changed", handler as EventListener)
    }
  }, [callback])
}
