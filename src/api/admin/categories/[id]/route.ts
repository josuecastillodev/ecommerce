/**
 * Admin Category Detail API
 * GET /admin/categories/:id - Get single category
 * POST /admin/categories/:id - Update category
 * DELETE /admin/categories/:id - Delete category
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CATEGORY_MODULE } from "../../../../modules/category"
import type CategoryModuleService from "../../../../modules/category/service"
import { categoryValidators } from "../../../../modules/category/validators"

// GET /admin/categories/:id - Get single category
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const categoryService: CategoryModuleService = req.scope.resolve(CATEGORY_MODULE)
  const { id } = req.params

  try {
    const category = await categoryService.retrieveCategory(id)

    if (!category) {
      res.status(404).json({ message: "Category not found" })
      return
    }

    // Get children
    const children = await categoryService.getSubcategories(id)

    // Get parent if exists
    let parent = null
    if (category.parent_id) {
      parent = await categoryService.retrieveCategory(category.parent_id)
    }

    res.json({
      category: {
        ...category,
        children,
        parent,
      },
    })
  } catch (error) {
    res.status(404).json({ message: "Category not found" })
  }
}

// POST /admin/categories/:id - Update category
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const categoryService: CategoryModuleService = req.scope.resolve(CATEGORY_MODULE)
  const { id } = req.params

  // Get existing category
  let existingCategory
  try {
    existingCategory = await categoryService.retrieveCategory(id)
  } catch {
    res.status(404).json({ message: "Category not found" })
    return
  }

  // Validate request body
  const parseResult = categoryValidators.updateCategory.safeParse(req.body)

  if (!parseResult.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parseResult.error.flatten().fieldErrors,
    })
    return
  }

  const input = parseResult.data

  // If changing parent, validate depth
  if (input.parent_id !== undefined && input.parent_id !== existingCategory.parent_id) {
    // Check if this category has children
    const children = await categoryService.getSubcategories(id)

    if (children.length > 0 && input.parent_id !== null) {
      // Check if new parent has a parent (would make children level 3)
      const newParent = await categoryService.retrieveCategory(input.parent_id)
      if (newParent?.parent_id) {
        res.status(400).json({
          message: "Cannot move a category with subcategories under another subcategory",
        })
        return
      }
    }

    if (input.parent_id !== null) {
      const depthValidation = await categoryService.validateDepth(input.parent_id)
      if (!depthValidation.valid) {
        res.status(400).json({ message: depthValidation.message })
        return
      }
    }
  }

  // If changing slug, validate uniqueness
  if (input.slug && input.slug !== existingCategory.slug) {
    const slugValidation = await categoryService.validateSlugUniqueness(
      input.slug,
      existingCategory.brand_id,
      id
    )
    if (!slugValidation.valid) {
      res.status(400).json({ message: slugValidation.message })
      return
    }
  }

  // Build update data
  const updateData: Record<string, unknown> = { id }

  if (input.name !== undefined) updateData.name = input.name
  if (input.slug !== undefined) updateData.slug = input.slug
  if (input.description !== undefined) updateData.description = input.description
  if (input.image_url !== undefined) updateData.image_url = input.image_url
  if (input.parent_id !== undefined) updateData.parent_id = input.parent_id
  if (input.position !== undefined) updateData.position = input.position
  if (input.is_active !== undefined) updateData.is_active = input.is_active
  if (input.metadata !== undefined) updateData.metadata = input.metadata

  // Update category
  const category = await categoryService.updateCategories(updateData)

  res.json({ category })
}

// DELETE /admin/categories/:id - Delete category
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const categoryService: CategoryModuleService = req.scope.resolve(CATEGORY_MODULE)
  const { id } = req.params

  try {
    await categoryService.retrieveCategory(id)
  } catch {
    res.status(404).json({ message: "Category not found" })
    return
  }

  // Handle subcategories - move them to root
  await categoryService.handleParentDeletion(id)

  // Delete category
  await categoryService.deleteCategories(id)

  res.status(200).json({
    id,
    object: "category",
    deleted: true,
  })
}
