import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CUSTOMER_BRAND_MODULE } from "../../../../../modules/customer-brand"
import { BRAND_MODULE } from "../../../../../modules/brand"
import type BrandModuleService from "../../../../../modules/brand/service"
import type CustomerBrandModuleService from "../../../../../modules/customer-brand/service"

/**
 * GET /store/customers/me/brand
 * Return the authenticated customer's brand and per-brand preferences.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const customerId = req.auth_context?.actor_id

  if (!customerId) {
    res.status(401).json({ message: "No autenticado." })
    return
  }

  const customerBrandService: CustomerBrandModuleService = req.scope.resolve(CUSTOMER_BRAND_MODULE)
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)

  const customerBrand = await customerBrandService.findByCustomerId(customerId)

  if (!customerBrand) {
    res.status(404).json({
      message: "Tu cuenta no está asociada a ninguna marca.",
    })
    return
  }

  const [brand] = await brandService.listBrands({ id: customerBrand.brand_id })

  res.json({
    brand: brand
      ? {
          id: brand.id,
          name: brand.name,
          slug: brand.slug,
          logo_url: brand.logo_url,
          primary_color: brand.primary_color,
        }
      : null,
    preferences: {
      marketing_consent: customerBrand.marketing_consent,
      language_preference: customerBrand.language_preference,
      metadata: customerBrand.metadata ?? null,
    },
  })
}

/**
 * POST /store/customers/me/brand
 * Update the authenticated customer's per-brand preferences.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const customerId = req.auth_context?.actor_id

  if (!customerId) {
    res.status(401).json({ message: "No autenticado." })
    return
  }

  const { marketing_consent, language_preference, metadata } =
    req.validatedBody as {
      marketing_consent?: boolean
      language_preference?: "es" | "en"
      metadata?: Record<string, unknown>
    }

  const customerBrandService: CustomerBrandModuleService = req.scope.resolve(CUSTOMER_BRAND_MODULE)

  const customerBrand = await customerBrandService.findByCustomerId(customerId)

  if (!customerBrand) {
    res.status(404).json({
      message: "Tu cuenta no está asociada a ninguna marca.",
    })
    return
  }

  const preferences: Record<string, unknown> = {}
  if (marketing_consent !== undefined) preferences.marketing_consent = marketing_consent
  if (language_preference !== undefined) preferences.language_preference = language_preference
  if (metadata !== undefined) preferences.metadata = metadata

  await customerBrandService.updateCustomerPreferences(customerId, preferences)

  const updated = await customerBrandService.findByCustomerId(customerId)

  res.json({
    preferences: {
      marketing_consent: updated.marketing_consent,
      language_preference: updated.language_preference,
      metadata: updated.metadata ?? null,
    },
    message: "Preferencias actualizadas.",
  })
}
