/**
 * CustomerBrand Module Types
 */

export interface CustomerBrandDTO {
  id: string
  customer_id: string
  brand_id: string
  registered_from: "storefront" | "admin" | "api"
  marketing_consent: boolean
  language_preference: string
  metadata?: Record<string, unknown> | null
  created_at?: Date
  updated_at?: Date
}

export interface CreateCustomerBrandInput {
  customer_id: string
  brand_id: string
  registered_from?: "storefront" | "admin" | "api"
  marketing_consent?: boolean
  language_preference?: string
  metadata?: Record<string, unknown>
}

export interface UpdateCustomerBrandInput {
  id: string
  marketing_consent?: boolean
  language_preference?: string
  metadata?: Record<string, unknown>
}

export interface CustomerWithBrand {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  has_account: boolean
  created_at: Date
  updated_at: Date
  // Brand association
  brand_id: string
  brand_name?: string
  brand_slug?: string
}

export interface CustomerRegistrationInput {
  email: string
  password: string
  first_name: string
  last_name: string
  phone?: string
  brand_id: string
  marketing_consent?: boolean
}

export interface CustomerLoginInput {
  email: string
  password: string
  brand_id: string
}

export interface CustomerProfileResponse {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  brand: {
    id: string
    name: string
    slug: string
    logo_url: string | null
    primary_color: string
  }
  addresses: CustomerAddress[]
  orders_count: number
  total_spent: number
  created_at: Date
}

export interface CustomerAddress {
  id: string
  customer_id: string
  first_name: string
  last_name: string
  address_1: string
  address_2?: string | null
  city: string
  province?: string | null
  postal_code: string
  country_code: string
  phone?: string | null
  company?: string | null
  is_default_shipping: boolean
  is_default_billing: boolean
  metadata?: Record<string, unknown> | null
}

export interface CreateAddressInput {
  first_name: string
  last_name: string
  address_1: string
  address_2?: string
  city: string
  province?: string
  postal_code: string
  country_code: string
  phone?: string
  company?: string
  is_default_shipping?: boolean
  is_default_billing?: boolean
  metadata?: Record<string, unknown>
}

export interface UpdateAddressInput {
  id: string
  first_name?: string
  last_name?: string
  address_1?: string
  address_2?: string
  city?: string
  province?: string
  postal_code?: string
  country_code?: string
  phone?: string
  company?: string
  is_default_shipping?: boolean
  is_default_billing?: boolean
  metadata?: Record<string, unknown>
}
