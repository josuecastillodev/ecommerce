import { MedusaService } from "@medusajs/framework/utils"
import { Brand } from "./models"

class BrandModuleService extends MedusaService({
  Brand,
}) {
  // Custom methods for brand operations

  async findBySlug(slug: string) {
    const [brand] = await this.listBrands({ slug })
    return brand || null
  }

  async findActive() {
    return this.listBrands({ active: true })
  }

  async activate(id: string) {
    return this.updateBrands({ id, active: true })
  }

  async deactivate(id: string) {
    return this.updateBrands({ id, active: false })
  }
}

export default BrandModuleService
