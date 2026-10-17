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

  async findByCustomerAndChannel(customerId: string, salesChannelId: string) {
    const [customerBrand] = await this.listCustomerBrands({
      customer_id: customerId,
      sales_channel_id: salesChannelId,
    })
    return customerBrand || null
  }

  async listByChannel(salesChannelId: string) {
    return this.listCustomerBrands({ sales_channel_id: salesChannelId })
  }

  async customerBelongsToChannel(customerId: string, salesChannelId: string): Promise<boolean> {
    return (await this.findByCustomerAndChannel(customerId, salesChannelId)) !== null
  }

  async getCustomerChannelId(customerId: string): Promise<string | null> {
    const association = await this.findByCustomerId(customerId)
    return association?.sales_channel_id || null
  }

  async associateCustomerWithChannel(
    customerId: string,
    salesChannelId: string,
    options?: {
      registered_from?: "storefront" | "admin" | "api"
      marketing_consent?: boolean
      language_preference?: string
      metadata?: Record<string, unknown>
    }
  ) {
    const existing = await this.findByCustomerId(customerId)
    if (existing) {
      throw new Error(`Customer ${customerId} is already associated with sales channel ${existing.sales_channel_id}`)
    }
    return this.createCustomerBrands({
      customer_id: customerId,
      sales_channel_id: salesChannelId,
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

  async getCustomerCountByChannel(salesChannelId: string): Promise<number> {
    return (await this.listByChannel(salesChannelId)).length
  }
}

export default CustomerBrandModuleService
