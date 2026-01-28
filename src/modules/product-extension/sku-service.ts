/**
 * SKU Generation Service
 * Handles automatic SKU generation with format: {brand_slug}-{product_slug}-{size}-{color}
 */

import type { SKUGenerationInput } from "./types"

export class SKUService {
  /**
   * Generate a SKU from the given input
   * Format: {brand_slug}-{product_slug}-{size}-{color}
   * Example: urban-street-classic-tee-M-negro
   */
  static generate(input: SKUGenerationInput): string {
    const { brand_slug, product_slug, size, color_name } = input

    // Normalize all parts to lowercase and remove special characters
    const normalizedBrand = this.normalizeSlug(brand_slug)
    const normalizedProduct = this.normalizeSlug(product_slug)
    const normalizedSize = size.toUpperCase()
    const normalizedColor = this.normalizeSlug(color_name)

    return `${normalizedBrand}-${normalizedProduct}-${normalizedSize}-${normalizedColor}`
  }

  /**
   * Generate SKU for a variant
   */
  static generateForVariant(
    brandSlug: string,
    productSlug: string,
    size: string,
    colorName: string
  ): string {
    return this.generate({
      brand_slug: brandSlug,
      product_slug: productSlug,
      size: size as SKUGenerationInput["size"],
      color_name: colorName,
    })
  }

  /**
   * Normalize a string to be used in a slug
   * - Converts to lowercase
   * - Replaces spaces with hyphens
   * - Removes special characters
   * - Removes accents
   */
  private static normalizeSlug(value: string): string {
    return value
      .toLowerCase()
      .trim()
      // Remove accents
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      // Replace spaces and underscores with hyphens
      .replace(/[\s_]+/g, "-")
      // Remove special characters except hyphens
      .replace(/[^a-z0-9-]/g, "")
      // Remove consecutive hyphens
      .replace(/-+/g, "-")
      // Remove leading/trailing hyphens
      .replace(/^-|-$/g, "")
  }

  /**
   * Generate a product slug from title
   */
  static generateProductSlug(title: string): string {
    return this.normalizeSlug(title)
  }

  /**
   * Parse a SKU to extract its components
   */
  static parse(sku: string): {
    brand_slug: string
    product_slug: string
    size: string
    color: string
  } | null {
    const parts = sku.split("-")

    // SKU must have at least 4 parts (brand-product-size-color)
    // But product slug can have multiple parts
    if (parts.length < 4) {
      return null
    }

    // Size is always second to last, color is last
    const color = parts.pop()!
    const size = parts.pop()!
    const brand_slug = parts.shift()!
    const product_slug = parts.join("-")

    return {
      brand_slug,
      product_slug,
      size,
      color,
    }
  }

  /**
   * Validate SKU format
   */
  static isValid(sku: string): boolean {
    const parsed = this.parse(sku)
    if (!parsed) return false

    // Check size is valid
    const validSizes = ["XS", "S", "M", "L", "XL", "XXL"]
    return validSizes.includes(parsed.size.toUpperCase())
  }
}

export default SKUService
