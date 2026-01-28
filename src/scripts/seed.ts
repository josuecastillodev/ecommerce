import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { BRAND_MODULE } from "../modules/brand"
import type BrandModuleService from "../modules/brand/service"
import { createProductWithBrandWorkflow } from "../workflows/create-product-with-brand"
import type { CreateProductWithBrandInput } from "../modules/product-extension/types"

export default async function seed({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const brandService: BrandModuleService = container.resolve(BRAND_MODULE)

  logger.info("Starting seed process...")

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
  // 2. Create Products
  // ==================
  logger.info("Seeding products...")

  const productsData: CreateProductWithBrandInput[] = [
    // Urban Street Products
    {
      brand_id: brands["urban-street"].id,
      title: "Camiseta Grafitti",
      description: "Camiseta de algodón premium con estampado de grafitti exclusivo. Perfecta para un look urbano y desenfadado.",
      base_price: 45000, // 450.00 MXN (prices in cents)
      currency_code: "MXN",
      status: "published",
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

  logger.info("Seed process completed!")
}
