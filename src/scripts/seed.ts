import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createCustomerAccountWorkflow,
  createInventoryLevelsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkProductsToSalesChannelWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"
import { BRAND_MODULE } from "../modules/brand"
import { CATEGORY_MODULE } from "../modules/category"
import { CUSTOMER_BRAND_MODULE } from "../modules/customer-brand"
import type BrandModuleService from "../modules/brand/service"
import type CategoryModuleService from "../modules/category/service"
import type CustomerBrandModuleService from "../modules/customer-brand/service"
import { createProductWithBrandWorkflow } from "../workflows/create-product-with-brand"
import type { CreateProductWithBrandInput } from "../modules/product-extension/types"

const MANUAL_FULFILLMENT_PROVIDER = "manual_manual"

/**
 * Ignore "already linked" errors so the seed stays idempotent.
 */
async function safeLink(fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (error: any) {
    if (!/already exist|duplicate|unique/i.test(error?.message ?? "")) {
      throw error
    }
  }
}

export default async function seed({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)

  const brandService: BrandModuleService = container.resolve(BRAND_MODULE)
  const categoryService: CategoryModuleService = container.resolve(CATEGORY_MODULE)
  const customerBrandService: CustomerBrandModuleService =
    container.resolve(CUSTOMER_BRAND_MODULE)

  const storeModule = container.resolve(Modules.STORE)
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)
  const regionModule = container.resolve(Modules.REGION)
  const taxModule = container.resolve(Modules.TAX)
  const stockLocationModule = container.resolve(Modules.STOCK_LOCATION)
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT)
  const apiKeyModule = container.resolve(Modules.API_KEY)
  const authModule = container.resolve(Modules.AUTH)
  const customerModule = container.resolve(Modules.CUSTOMER)

  logger.info("Starting seed process...")

  // ============================================================
  // 0. Commerce fundamentals (region, channel, fulfillment, key)
  // ============================================================
  logger.info("Seeding commerce fundamentals...")

  // Sales channel — reuse the one Medusa creates on first boot.
  let [salesChannel] = await salesChannelModule.listSalesChannels(
    {},
    { take: 1, order: { created_at: "ASC" } }
  )
  if (!salesChannel) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ name: "Tienda Multi-Marca" }] },
    })
    salesChannel = result[0]
    logger.info("Created sales channel")
  }

  // Store — set MXN as the default supported currency + default channel.
  const [store] = await storeModule.listStores()
  if (store) {
    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: store.id },
        update: {
          supported_currencies: [{ currency_code: "mxn", is_default: true }],
          default_sales_channel_id: salesChannel.id,
        },
      },
    })
  }

  // Region — Mexico, MXN, cards + OXXO + manual.
  let [region] = await regionModule.listRegions({ name: "México" })
  if (!region) {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: "México",
            currency_code: "mxn",
            countries: ["mx"],
            payment_providers: [
              "pp_system_default",
              "pp_stripe_stripe",
              "pp_stripe-oxxo_stripe",
            ],
          },
        ],
      },
    })
    region = result[0]
    logger.info("Created region: México")
  }

  // Tax region — MX.
  const existingTaxRegions = await taxModule.listTaxRegions({ country_code: "mx" })
  if (existingTaxRegions.length === 0) {
    await createTaxRegionsWorkflow(container).run({
      input: [{ country_code: "mx" }],
    })
    logger.info("Created tax region: MX")
  }

  // Stock location — a single warehouse in CDMX.
  let [stockLocation] = await stockLocationModule.listStockLocations({
    name: "Almacén CDMX",
  })
  if (!stockLocation) {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: "Almacén CDMX",
            address: {
              address_1: "Av. Paseo de la Reforma 1",
              city: "Ciudad de México",
              country_code: "mx",
              postal_code: "06600",
            },
          },
        ],
      },
    })
    stockLocation = result[0]
    logger.info("Created stock location: Almacén CDMX")
  }

  await safeLink(() =>
    link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
      [Modules.FULFILLMENT]: {
        fulfillment_provider_id: MANUAL_FULFILLMENT_PROVIDER,
      },
    })
  )

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: stockLocation.id, add: [salesChannel.id] },
  })

  // Fulfillment set + service zone for Mexico.
  let [fulfillmentSet] = await fulfillmentModule.listFulfillmentSets(
    { name: "Envíos MX" },
    { relations: ["service_zones"] }
  )
  if (!fulfillmentSet) {
    fulfillmentSet = await fulfillmentModule.createFulfillmentSets({
      name: "Envíos MX",
      type: "shipping",
      service_zones: [
        {
          name: "México",
          geo_zones: [{ country_code: "mx", type: "country" }],
        },
      ],
    })
    logger.info("Created fulfillment set: Envíos MX")
  }

  let serviceZones = fulfillmentSet.service_zones ?? []
  if (serviceZones.length === 0) {
    const [reloaded] = await fulfillmentModule.listFulfillmentSets(
      { id: fulfillmentSet.id },
      { relations: ["service_zones"] }
    )
    serviceZones = reloaded?.service_zones ?? []
  }
  const serviceZone = serviceZones[0]

  await safeLink(() =>
    link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
      [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
    })
  )

  // Shipping profile — reuse Medusa's default.
  let [shippingProfile] = await fulfillmentModule.listShippingProfiles({
    type: "default",
  })
  if (!shippingProfile) {
    const { result } = await createShippingProfilesWorkflow(container).run({
      input: { data: [{ name: "Default", type: "default" }] },
    })
    shippingProfile = result[0]
  }

  // Shipping options — standard + express, priced in MXN (centavos, matching
  // the product price convention already used in this seed).
  const existingShippingOptions = await fulfillmentModule.listShippingOptions({
    name: ["Envío Estándar", "Envío Exprés"],
  })
  if (existingShippingOptions.length < 2 && serviceZone) {
    await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: "Envío Estándar",
          price_type: "flat",
          provider_id: MANUAL_FULFILLMENT_PROVIDER,
          service_zone_id: serviceZone.id,
          shipping_profile_id: shippingProfile.id,
          type: {
            label: "Estándar",
            description: "Entrega en 3-5 días hábiles",
            code: "standard",
          },
          prices: [
            { currency_code: "mxn", amount: 9900 },
            { region_id: region.id, amount: 9900 },
          ],
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" },
            { attribute: "is_return", value: "false", operator: "eq" },
          ],
        },
        {
          name: "Envío Exprés",
          price_type: "flat",
          provider_id: MANUAL_FULFILLMENT_PROVIDER,
          service_zone_id: serviceZone.id,
          shipping_profile_id: shippingProfile.id,
          type: {
            label: "Exprés",
            description: "Entrega en 1-2 días hábiles",
            code: "express",
          },
          prices: [
            { currency_code: "mxn", amount: 19900 },
            { region_id: region.id, amount: 19900 },
          ],
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" },
            { attribute: "is_return", value: "false", operator: "eq" },
          ],
        },
      ],
    })
    logger.info("Created shipping options: Estándar + Exprés")
  }

  // Publishable API key — required for every /store/* request.
  let [publishableKey] = await apiKeyModule.listApiKeys({ type: "publishable" })
  if (!publishableKey) {
    const { result } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [
          { title: "Storefront", type: "publishable", created_by: "seed" },
        ],
      },
    })
    publishableKey = result[0]
    logger.info("Created publishable API key")
  }
  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: { id: publishableKey.id, add: [salesChannel.id] },
  })

  // ==================
  // 1. Create Brands
  // ==================
  logger.info("Seeding brands...")

  const brandsData = [
    {
      name: "Urban Street",
      slug: "urban-street",
      description: "Streetwear urbano para jóvenes audaces",
      primary_color: "#1A1A1A",
      secondary_color: "#FF4444",
      active: true,
      metadata: {
        target_audience: "18-30",
        style: "streetwear",
      },
    },
    {
      name: "Classic Threads",
      slug: "classic-threads",
      description: "Moda clásica y atemporal para toda ocasión",
      primary_color: "#2C3E50",
      secondary_color: "#ECF0F1",
      active: true,
      metadata: {
        target_audience: "25-45",
        style: "classic",
      },
    },
  ]

  const brands: Record<string, any> = {}

  for (const brandData of brandsData) {
    let brand = await brandService.findBySlug(brandData.slug)

    if (!brand) {
      brand = await brandService.createBrands(brandData)
      logger.info(`Created brand: ${brandData.name}`)
    } else {
      logger.info(`Brand already exists: ${brandData.name}`)
    }

    brands[brandData.slug] = brand
  }

  // ==================
  // 2. Create Categories
  // ==================
  logger.info("Seeding categories...")

  const categories: Record<string, any> = {}

  // Global categories (shared across all brands)
  const globalCategoriesData = [
    {
      name: "Playeras",
      slug: "playeras",
      description: "Todo tipo de playeras y camisetas",
      brand_id: null,
      position: 0,
    },
    {
      name: "Polos",
      slug: "polos",
      description: "Polos clásicos y modernos",
      brand_id: null,
      position: 1,
    },
    {
      name: "Edición Limitada",
      slug: "edicion-limitada",
      description: "Productos de edición limitada",
      brand_id: null,
      position: 2,
    },
  ]

  // Create global categories
  for (const catData of globalCategoriesData) {
    let category = await categoryService.findBySlug(catData.slug, null)

    if (!category) {
      category = await categoryService.createCategories({
        ...catData,
        is_active: true,
      })
      logger.info(`Created global category: ${catData.name}`)
    } else {
      logger.info(`Global category already exists: ${catData.name}`)
    }

    categories[catData.slug] = category
  }

  // Subcategories for "Playeras"
  const playerasSubcategories = [
    {
      name: "Manga Corta",
      slug: "manga-corta",
      description: "Playeras de manga corta",
      parent_id: categories["playeras"].id,
      brand_id: null,
      position: 0,
    },
    {
      name: "Manga Larga",
      slug: "manga-larga",
      description: "Playeras de manga larga",
      parent_id: categories["playeras"].id,
      brand_id: null,
      position: 1,
    },
    {
      name: "Sin Mangas",
      slug: "sin-mangas",
      description: "Playeras sin mangas / tank tops",
      parent_id: categories["playeras"].id,
      brand_id: null,
      position: 2,
    },
  ]

  for (const catData of playerasSubcategories) {
    let category = await categoryService.findBySlug(catData.slug, null)

    if (!category) {
      category = await categoryService.createCategories({
        ...catData,
        is_active: true,
      })
      logger.info(`Created subcategory: ${catData.name}`)
    } else {
      logger.info(`Subcategory already exists: ${catData.name}`)
    }

    categories[catData.slug] = category
  }

  // Brand-specific categories for Urban Street
  const urbanStreetCategories = [
    {
      name: "Streetwear",
      slug: "streetwear",
      description: "Colección streetwear exclusiva",
      brand_id: brands["urban-street"].id,
      position: 0,
    },
    {
      name: "Colaboraciones",
      slug: "colaboraciones",
      description: "Colaboraciones con artistas urbanos",
      brand_id: brands["urban-street"].id,
      position: 1,
    },
  ]

  for (const catData of urbanStreetCategories) {
    let category = await categoryService.findBySlug(catData.slug, catData.brand_id)

    if (!category) {
      category = await categoryService.createCategories({
        ...catData,
        is_active: true,
      })
      logger.info(`Created Urban Street category: ${catData.name}`)
    } else {
      logger.info(`Urban Street category already exists: ${catData.name}`)
    }

    categories[`urban-${catData.slug}`] = category
  }

  // Brand-specific categories for Classic Threads
  const classicThreadsCategories = [
    {
      name: "Casual",
      slug: "casual",
      description: "Ropa casual para el día a día",
      brand_id: brands["classic-threads"].id,
      position: 0,
    },
    {
      name: "Formal",
      slug: "formal",
      description: "Piezas para ocasiones formales",
      brand_id: brands["classic-threads"].id,
      position: 1,
    },
    {
      name: "Esenciales",
      slug: "esenciales",
      description: "Básicos que no pueden faltar",
      brand_id: brands["classic-threads"].id,
      position: 2,
    },
  ]

  for (const catData of classicThreadsCategories) {
    let category = await categoryService.findBySlug(catData.slug, catData.brand_id)

    if (!category) {
      category = await categoryService.createCategories({
        ...catData,
        is_active: true,
      })
      logger.info(`Created Classic Threads category: ${catData.name}`)
    } else {
      logger.info(`Classic Threads category already exists: ${catData.name}`)
    }

    categories[`classic-${catData.slug}`] = category
  }

  // ==================
  // 3. Create Products
  // ==================
  logger.info("Seeding products...")

  const productsData: CreateProductWithBrandInput[] = [
    // Urban Street Products
    {
      brand_id: brands["urban-street"].id,
      title: "Camiseta Grafitti",
      description: "Camiseta de algodón premium con estampado de grafitti exclusivo. Perfecta para un look urbano y desenfadado.",
      base_price: 45000,
      currency_code: "MXN",
      status: "published",
      category_ids: [categories["playeras"].id, categories["manga-corta"].id, categories["urban-streetwear"].id],
      variants: [
        { size: "S", color: { name: "Negro", hex_code: "#000000" }, stock: 25 },
        { size: "M", color: { name: "Negro", hex_code: "#000000" }, stock: 30 },
        { size: "L", color: { name: "Negro", hex_code: "#000000" }, stock: 20 },
        { size: "XL", color: { name: "Negro", hex_code: "#000000" }, stock: 15 },
        { size: "S", color: { name: "Blanco", hex_code: "#FFFFFF" }, stock: 20 },
        { size: "M", color: { name: "Blanco", hex_code: "#FFFFFF" }, stock: 25 },
        { size: "L", color: { name: "Blanco", hex_code: "#FFFFFF" }, stock: 18 },
        { size: "XL", color: { name: "Blanco", hex_code: "#FFFFFF" }, stock: 12 },
      ],
    },
    {
      brand_id: brands["urban-street"].id,
      title: "Playera Oversized Minimal",
      description: "Playera oversized con corte relajado. Algodón 100% peinado para máxima comodidad.",
      base_price: 52000,
      currency_code: "MXN",
      status: "published",
      category_ids: [categories["playeras"].id, categories["urban-streetwear"].id],
      variants: [
        { size: "M", color: { name: "Gris Oscuro", hex_code: "#333333" }, stock: 40 },
        { size: "L", color: { name: "Gris Oscuro", hex_code: "#333333" }, stock: 35 },
        { size: "XL", color: { name: "Gris Oscuro", hex_code: "#333333" }, stock: 30 },
        { size: "XXL", color: { name: "Gris Oscuro", hex_code: "#333333" }, stock: 20 },
        { size: "M", color: { name: "Negro", hex_code: "#000000" }, stock: 45 },
        { size: "L", color: { name: "Negro", hex_code: "#000000" }, stock: 40 },
        { size: "XL", color: { name: "Negro", hex_code: "#000000" }, stock: 35 },
        { size: "XXL", color: { name: "Negro", hex_code: "#000000" }, stock: 25 },
      ],
    },
    {
      brand_id: brands["urban-street"].id,
      title: "T-Shirt Neon Dreams",
      description: "Diseño exclusivo con estampado neón que brilla en la oscuridad. Edición limitada.",
      base_price: 65000,
      currency_code: "MXN",
      status: "published",
      category_ids: [categories["playeras"].id, categories["edicion-limitada"].id, categories["urban-colaboraciones"].id],
      variants: [
        { size: "XS", color: { name: "Negro", hex_code: "#000000" }, stock: 10 },
        { size: "S", color: { name: "Negro", hex_code: "#000000" }, stock: 15 },
        { size: "M", color: { name: "Negro", hex_code: "#000000" }, stock: 20 },
        { size: "L", color: { name: "Negro", hex_code: "#000000" }, stock: 15 },
        { size: "XL", color: { name: "Negro", hex_code: "#000000" }, stock: 10 },
      ],
    },

    // Classic Threads Products
    {
      brand_id: brands["classic-threads"].id,
      title: "Polo Ejecutivo",
      description: "Polo de corte clásico con cuello reforzado. Ideal para ocasiones semi-formales.",
      base_price: 68000,
      currency_code: "MXN",
      status: "published",
      category_ids: [categories["polos"].id, categories["classic-formal"].id],
      variants: [
        { size: "S", color: { name: "Azul Marino", hex_code: "#1A237E" }, stock: 20 },
        { size: "M", color: { name: "Azul Marino", hex_code: "#1A237E" }, stock: 30 },
        { size: "L", color: { name: "Azul Marino", hex_code: "#1A237E" }, stock: 25 },
        { size: "XL", color: { name: "Azul Marino", hex_code: "#1A237E" }, stock: 20 },
        { size: "S", color: { name: "Blanco", hex_code: "#FFFFFF" }, stock: 25 },
        { size: "M", color: { name: "Blanco", hex_code: "#FFFFFF" }, stock: 35 },
        { size: "L", color: { name: "Blanco", hex_code: "#FFFFFF" }, stock: 30 },
        { size: "XL", color: { name: "Blanco", hex_code: "#FFFFFF" }, stock: 20 },
        { size: "S", color: { name: "Gris", hex_code: "#757575" }, stock: 15 },
        { size: "M", color: { name: "Gris", hex_code: "#757575" }, stock: 25 },
        { size: "L", color: { name: "Gris", hex_code: "#757575" }, stock: 20 },
        { size: "XL", color: { name: "Gris", hex_code: "#757575" }, stock: 15 },
      ],
    },
    {
      brand_id: brands["classic-threads"].id,
      title: "Camiseta Básica Premium",
      description: "La camiseta básica perfecta. Algodón Pima de alta calidad con acabado suave.",
      base_price: 42000,
      currency_code: "MXN",
      status: "published",
      category_ids: [categories["playeras"].id, categories["manga-corta"].id, categories["classic-esenciales"].id],
      variants: [
        { size: "XS", color: { name: "Blanco", hex_code: "#FFFFFF" }, stock: 50 },
        { size: "S", color: { name: "Blanco", hex_code: "#FFFFFF" }, stock: 60 },
        { size: "M", color: { name: "Blanco", hex_code: "#FFFFFF" }, stock: 70 },
        { size: "L", color: { name: "Blanco", hex_code: "#FFFFFF" }, stock: 55 },
        { size: "XL", color: { name: "Blanco", hex_code: "#FFFFFF" }, stock: 40 },
        { size: "XXL", color: { name: "Blanco", hex_code: "#FFFFFF" }, stock: 25 },
        { size: "XS", color: { name: "Negro", hex_code: "#000000" }, stock: 45 },
        { size: "S", color: { name: "Negro", hex_code: "#000000" }, stock: 55 },
        { size: "M", color: { name: "Negro", hex_code: "#000000" }, stock: 65 },
        { size: "L", color: { name: "Negro", hex_code: "#000000" }, stock: 50 },
        { size: "XL", color: { name: "Negro", hex_code: "#000000" }, stock: 35 },
        { size: "XXL", color: { name: "Negro", hex_code: "#000000" }, stock: 20 },
      ],
    },
    {
      brand_id: brands["classic-threads"].id,
      title: "Henley Casual",
      description: "Camiseta estilo Henley con botones de madera. Look casual pero sofisticado.",
      base_price: 55000,
      currency_code: "MXN",
      status: "published",
      category_ids: [categories["playeras"].id, categories["classic-casual"].id],
      variants: [
        { size: "S", color: { name: "Beige", hex_code: "#F5F5DC" }, stock: 20 },
        { size: "M", color: { name: "Beige", hex_code: "#F5F5DC" }, stock: 30 },
        { size: "L", color: { name: "Beige", hex_code: "#F5F5DC" }, stock: 25 },
        { size: "XL", color: { name: "Beige", hex_code: "#F5F5DC" }, stock: 15 },
        { size: "S", color: { name: "Verde Olivo", hex_code: "#556B2F" }, stock: 18 },
        { size: "M", color: { name: "Verde Olivo", hex_code: "#556B2F" }, stock: 25 },
        { size: "L", color: { name: "Verde Olivo", hex_code: "#556B2F" }, stock: 22 },
        { size: "XL", color: { name: "Verde Olivo", hex_code: "#556B2F" }, stock: 12 },
      ],
    },
  ]

  const workflow = createProductWithBrandWorkflow(container)

  for (const productData of productsData) {
    try {
      const { result: product } = await workflow.run({ input: productData })
      logger.info(`Created product: ${product.title} (${product.variants?.length || 0} variants)`)
    } catch (error: any) {
      // Skip if product already exists (SKU conflict)
      if (error.message?.includes("SKU") && error.message?.includes("already exists")) {
        logger.info(`Product already exists: ${productData.title}`)
      } else {
        logger.error(`Failed to create product ${productData.title}: ${error.message}`)
      }
    }
  }

  // ============================================================
  // 4. Make products purchasable: sales channel + inventory
  // ============================================================
  const { data: allProducts } = await query.graph({
    entity: "product",
    fields: ["id"],
  })
  if (allProducts.length > 0) {
    await linkProductsToSalesChannelWorkflow(container).run({
      input: { id: salesChannel.id, add: allProducts.map((p: any) => p.id) },
    })
    logger.info(`Linked ${allProducts.length} products to the sales channel`)
  }

  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id"],
  })
  const { data: inventoryLevels } = await query.graph({
    entity: "inventory_level",
    fields: ["inventory_item_id", "location_id"],
  })
  const existingLevelKeys = new Set(
    inventoryLevels.map((l: any) => `${l.inventory_item_id}:${l.location_id}`)
  )
  const levelsToCreate = inventoryItems
    .filter(
      (item: any) => !existingLevelKeys.has(`${item.id}:${stockLocation.id}`)
    )
    .map((item: any) => ({
      inventory_item_id: item.id,
      location_id: stockLocation.id,
      stocked_quantity: 100,
    }))
  if (levelsToCreate.length > 0) {
    await createInventoryLevelsWorkflow(container).run({
      input: { inventory_levels: levelsToCreate },
    })
    logger.info(`Created ${levelsToCreate.length} inventory levels`)
  }

  // ==================
  // 5. Test customers (one per brand)
  // ==================
  logger.info("Seeding test customers...")

  const testCustomers = [
    {
      email: "ana@urban-street.mx",
      first_name: "Ana",
      last_name: "García",
      brand_slug: "urban-street",
    },
    {
      email: "luis@classic-threads.mx",
      first_name: "Luis",
      last_name: "Hernández",
      brand_slug: "classic-threads",
    },
  ]
  const TEST_CUSTOMER_PASSWORD = "Password123"

  for (const tc of testCustomers) {
    const [existing] = await customerModule.listCustomers({ email: tc.email })
    if (existing) {
      logger.info(`Test customer already exists: ${tc.email}`)
      continue
    }

    const brand = brands[tc.brand_slug]

    const authResponse = await authModule.register("emailpass", {
      body: { email: tc.email, password: TEST_CUSTOMER_PASSWORD },
    })

    if (!authResponse.success || !authResponse.authIdentity) {
      logger.error(
        `Failed to register auth identity for ${tc.email}: ${authResponse.error}`
      )
      continue
    }

    const { result: customer } = await createCustomerAccountWorkflow(container).run(
      {
        input: {
          authIdentityId: authResponse.authIdentity.id,
          customerData: {
            email: tc.email,
            first_name: tc.first_name,
            last_name: tc.last_name,
            metadata: { brand_id: brand.id },
          },
        },
      }
    )

    const alreadyLinked = await customerBrandService.findByCustomerId(customer.id)
    if (!alreadyLinked) {
      await customerBrandService.associateCustomerWithBrand(customer.id, brand.id, {
        registered_from: "api",
        language_preference: "es",
      })
    }

    logger.info(`Created test customer ${tc.email} → ${tc.brand_slug}`)
  }

  // ==================
  // Summary
  // ==================
  logger.info("Seed process completed!")
  logger.info("Summary:")
  logger.info(`  - Brands: ${Object.keys(brands).length}`)
  logger.info(`  - Categories: ${Object.keys(categories).length}`)
  logger.info(`  - Products: ${productsData.length}`)
  logger.info(`  - Region: México (MXN, cards + OXXO)`)
  logger.info(`  - Publishable API key: ${publishableKey.token}`)
  logger.info(`  - Test customers: ana@urban-street.mx / luis@classic-threads.mx (pass: ${TEST_CUSTOMER_PASSWORD})`)
}
