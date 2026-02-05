/**
 * Category Module Service
 * Handles category CRUD operations with hierarchy support
 */

import { MedusaService } from "@medusajs/framework/utils"
import { Category } from "./models"

type CategoryData = {
  id?: string
  name?: string
  slug?: string
  description?: string | null
  image_url?: string | null
  parent_id?: string | null
  brand_id?: string | null
  position?: number
  is_active?: boolean
  metadata?: Record<string, unknown> | null
}

class CategoryModuleService extends MedusaService({
  Category,
}) {
  /**
   * Find category by slug, optionally filtered by brand
   */
  async findBySlug(slug: string, brandId?: string | null): Promise<any | null> {
    const filters: Record<string, unknown> = { slug }

    if (brandId !== undefined) {
      filters.brand_id = brandId
    }

    const [category] = await this.listCategories(filters)
    return category || null
  }

  /**
   * Get all root categories (no parent)
   */
  async getRootCategories(brandId?: string | null): Promise<any[]> {
    const filters: Record<string, unknown> = { parent_id: null }

    if (brandId !== undefined) {
      filters.brand_id = brandId
    }

    return this.listCategories(filters, {
      order: { position: "ASC", name: "ASC" },
    })
  }

  /**
   * Get subcategories of a parent
   */
  async getSubcategories(parentId: string): Promise<any[]> {
    return this.listCategories(
      { parent_id: parentId },
      { order: { position: "ASC", name: "ASC" } }
    )
  }

  /**
   * Get category tree (root + children)
   */
  async getCategoryTree(brandId?: string | null): Promise<any[]> {
    // Get root categories
    const rootCategories = await this.getRootCategories(brandId)

    // For each root, get subcategories
    const tree = await Promise.all(
      rootCategories.map(async (root) => {
        const children = await this.getSubcategories(root.id)
        return {
          ...root,
          children,
        }
      })
    )

    return tree
  }

  /**
   * Get categories for a brand including global categories
   */
  async getCategoriesForBrand(brandId: string): Promise<any[]> {
    // Get brand-specific and global categories
    const [brandCategories, globalCategories] = await Promise.all([
      this.listCategories(
        { brand_id: brandId, is_active: true },
        { order: { position: "ASC", name: "ASC" } }
      ),
      this.listCategories(
        { brand_id: null, is_active: true },
        { order: { position: "ASC", name: "ASC" } }
      ),
    ])

    return [...globalCategories, ...brandCategories]
  }

  /**
   * Get category tree for a brand (including global)
   */
  async getCategoryTreeForBrand(brandId: string): Promise<any[]> {
    const allCategories = await this.getCategoriesForBrand(brandId)

    // Build tree from flat list
    const rootCategories = allCategories.filter((c) => !c.parent_id)
    const childrenMap = new Map<string, any[]>()

    // Group children by parent_id
    for (const cat of allCategories) {
      if (cat.parent_id) {
        const children = childrenMap.get(cat.parent_id) || []
        children.push(cat)
        childrenMap.set(cat.parent_id, children)
      }
    }

    // Attach children to roots
    return rootCategories.map((root) => ({
      ...root,
      children: childrenMap.get(root.id) || [],
    }))
  }

  /**
   * Validate category depth (max 2 levels)
   */
  async validateDepth(parentId: string | null): Promise<{ valid: boolean; message?: string }> {
    if (!parentId) {
      return { valid: true }
    }

    const parent = await this.retrieveCategory(parentId)

    if (!parent) {
      return { valid: false, message: "Parent category not found" }
    }

    // If parent already has a parent, this would be level 3
    if (parent.parent_id) {
      return {
        valid: false,
        message: "Maximum category depth is 2 levels. Cannot create subcategory of a subcategory.",
      }
    }

    return { valid: true }
  }

  /**
   * Validate slug uniqueness within brand scope
   */
  async validateSlugUniqueness(
    slug: string,
    brandId: string | null,
    excludeId?: string
  ): Promise<{ valid: boolean; message?: string }> {
    const existing = await this.findBySlug(slug, brandId)

    if (existing && existing.id !== excludeId) {
      const scope = brandId ? "this brand" : "global categories"
      return {
        valid: false,
        message: `Slug "${slug}" already exists in ${scope}`,
      }
    }

    return { valid: true }
  }

  /**
   * Handle parent deletion - move subcategories to root
   */
  async handleParentDeletion(parentId: string): Promise<void> {
    const subcategories = await this.getSubcategories(parentId)

    if (subcategories.length > 0) {
      await Promise.all(
        subcategories.map((sub) =>
          this.updateCategories({
            id: sub.id,
            parent_id: null,
          })
        )
      )
    }
  }

  /**
   * Get next position for a new category
   */
  async getNextPosition(parentId: string | null, brandId: string | null): Promise<number> {
    const filters: Record<string, unknown> = {
      parent_id: parentId,
      brand_id: brandId,
    }

    const siblings = await this.listCategories(filters, {
      order: { position: "DESC" },
      take: 1,
    })

    if (siblings.length === 0) {
      return 0
    }

    return (siblings[0].position || 0) + 1
  }

  /**
   * Reorder categories
   */
  async reorderCategories(
    categoryIds: string[],
    parentId: string | null = null
  ): Promise<void> {
    await Promise.all(
      categoryIds.map((id, index) =>
        this.updateCategories({
          id,
          parent_id: parentId,
          position: index,
        })
      )
    )
  }

  /**
   * Move category to new parent
   */
  async moveCategory(
    categoryId: string,
    newParentId: string | null
  ): Promise<any> {
    // Validate depth
    const depthValidation = await this.validateDepth(newParentId)
    if (!depthValidation.valid) {
      throw new Error(depthValidation.message)
    }

    // Get category's children if it has any
    const children = await this.getSubcategories(categoryId)
    if (children.length > 0 && newParentId) {
      // Check if new parent already has a parent
      const newParent = await this.retrieveCategory(newParentId)
      if (newParent?.parent_id) {
        throw new Error(
          "Cannot move a category with subcategories under another subcategory"
        )
      }
    }

    // Get next position in new location
    const category = await this.retrieveCategory(categoryId)
    const position = await this.getNextPosition(newParentId, category.brand_id)

    return this.updateCategories({
      id: categoryId,
      parent_id: newParentId,
      position,
    })
  }
}

export default CategoryModuleService
