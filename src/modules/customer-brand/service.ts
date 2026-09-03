import { MedusaService } from "@medusajs/framework/utils"
import { CustomerBrand } from "./models"

class CustomerBrandModuleService extends MedusaService({
  CustomerBrand,
}) {
  /**
   * Find customer-brand association by customer ID
   */
  async findByCustomerId(customerId: string) {
    const [customerBrand] = await this.listCustomerBrands({
      customer_id: customerId,
    })
    return customerBrand || null
  }

  /**
   * Find customer-brand association by customer ID and brand ID
   */
  async findByCustomerAndBrand(customerId: string, brandId: string) {
    const [customerBrand] = await this.listCustomerBrands({
      customer_id: customerId,
      brand_id: brandId,
    })
    return customerBrand || null
  }

  /**
   * Get all customers for a specific brand
   */
  async listByBrand(brandId: string) {
    return this.listCustomerBrands({ brand_id: brandId })
  }

  /**
   * Check if a customer belongs to a specific brand
   */
  async customerBelongsToBrand(customerId: string, brandId: string): Promise<boolean> {
    const association = await this.findByCustomerAndBrand(customerId, brandId)
    return association !== null
  }

  /**
   * Get the brand ID for a customer
   */
  async getCustomerBrandId(customerId: string): Promise<string | null> {
    const association = await this.findByCustomerId(customerId)
    return association?.brand_id || null
  }

  /**
   * Associate a customer with a brand
   */
  async associateCustomerWithBrand(
    customerId: string,
    brandId: string,
    options?: {
      registered_from?: "storefront" | "admin" | "api"
      marketing_consent?: boolean
      language_preference?: string
      metadata?: Record<string, unknown>
    }
  ) {
    // Check if association already exists
    const existing = await this.findByCustomerId(customerId)
    if (existing) {
      throw new Error(`Customer ${customerId} is already associated with brand ${existing.brand_id}`)
    }

    return this.createCustomerBrands({
      customer_id: customerId,
      brand_id: brandId,
      registered_from: options?.registered_from || "storefront",
      marketing_consent: options?.marketing_consent || false,
      language_preference: options?.language_preference || "es",
      metadata: options?.metadata || null,
    })
  }

  /**
   * Update customer's brand preferences
   */
  async updateCustomerPreferences(
    customerId: string,
    data: {
      marketing_consent?: boolean
      language_preference?: string
      metadata?: Record<string, unknown>
    }
  ) {
    const association = await this.findByCustomerId(customerId)
    if (!association) {
      throw new Error(`Customer ${customerId} has no brand association`)
    }

    return this.updateCustomerBrands({
      id: association.id,
      ...data,
    })
  }

  /**
   * Get customer count per brand
   */
  async getCustomerCountByBrand(brandId: string): Promise<number> {
    const customers = await this.listByBrand(brandId)
    return customers.length
  }
}

export default CustomerBrandModuleService
