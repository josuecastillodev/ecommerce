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
  sales_channel_id?: string | null
  position?: number
  is_active?: boolean
  metadata?: Record<string, unknown> | null
}

class CategoryModuleService extends MedusaService({
  Category,
}) {
  /**
   * Find category by slug, optionally filtered by marca (sales channel)
   */
  async findBySlug(slug: string, salesChannelId?: string | null): Promise<any | null> {
    const filters: Record<string, unknown> = { slug }

    if (salesChannelId !== undefined) {
      filters.sales_channel_id = salesChannelId
    }

    const [category] = await this.listCategories(filters)
    return category || null
  }

  /**
   * Get all root categories (no parent)
   */
  async getRootCategories(salesChannelId?: string | null): Promise<any[]> {
    const filters: Record<string, unknown> = { parent_id: null }

    if (salesChannelId !== undefined) {
      filters.sales_channel_id = salesChannelId
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
  async getCategoryTree(salesChannelId?: string | null): Promise<any[]> {
    // Get root categories
    const rootCategories = await this.getRootCategories(salesChannelId)

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
   * Get categories for a marca (sales channel) including global categories
   */
  async getCategoriesForChannel(salesChannelId: string): Promise<any[]> {
    // Get marca-specific and global categories
    const [channelCategories, globalCategories] = await Promise.all([
      this.listCategories(
        { sales_channel_id: salesChannelId, is_active: true },
        { order: { position: "ASC", name: "ASC" } }
      ),
      this.listCategories(
        { sales_channel_id: null, is_active: true },
        { order: { position: "ASC", name: "ASC" } }
      ),
    ])

    return [...globalCategories, ...channelCategories]
  }

  /**
   * Get category tree for a marca (sales channel) (including global)
   */
  async getCategoryTreeForChannel(salesChannelId: string): Promise<any[]> {
    const allCategories = await this.getCategoriesForChannel(salesChannelId)

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
   * Validate slug uniqueness within marca (sales channel) scope
   */
  async validateSlugUniqueness(
    slug: string,
    salesChannelId: string | null,
    excludeId?: string
  ): Promise<{ valid: boolean; message?: string }> {
    const existing = await this.findBySlug(slug, salesChannelId)

    if (existing && existing.id !== excludeId) {
      const scope = salesChannelId ? "this brand's sales channel" : "global categories"
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
  async getNextPosition(parentId: string | null, salesChannelId: string | null): Promise<number> {
    const filters: Record<string, unknown> = {
      parent_id: parentId,
      sales_channel_id: salesChannelId,
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
    const position = await this.getNextPosition(newParentId, category.sales_channel_id)

    return this.updateCategories({
      id: categoryId,
      parent_id: newParentId,
      position,
    })
  }
}

export default CategoryModuleService
