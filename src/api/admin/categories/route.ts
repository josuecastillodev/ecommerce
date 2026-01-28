/**
 * Admin Categories API
 * GET /admin/categories - List all categories
 * POST /admin/categories - Create category
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CATEGORY_MODULE } from "../../../modules/category"
import type CategoryModuleService from "../../../modules/category/service"
import {
  categoryValidators,
  generateSlug,
} from "../../../modules/category/validators"

// GET /admin/categories - List all categories with filters
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const categoryService: CategoryModuleService = req.scope.resolve(CATEGORY_MODULE)

  // Parse query params
  const parseResult = categoryValidators.adminCategoryFilters.safeParse(req.query)

  if (!parseResult.success) {
    res.status(400).json({
      message: "Invalid query parameters",
      errors: parseResult.error.flatten().fieldErrors,
    })
    return
  }

  const { brand_id, parent_id, is_active, search, tree, offset, limit } = parseResult.data

  // Build filters
  const filters: Record<string, unknown> = {}

  if (brand_id !== undefined) {
    filters.brand_id = brand_id
  }

  if (parent_id !== undefined) {
    filters.parent_id = parent_id
  }

  if (is_active && is_active !== "all") {
    filters.is_active = is_active === "true"
  }

  // If tree view requested
  if (tree === "true") {
    const categoryTree = brand_id
      ? await categoryService.getCategoryTree(brand_id)
      : await categoryService.getCategoryTree(null)

    res.json({
      categories: categoryTree,
      count: categoryTree.length,
    })
    return
  }

  // Regular list with pagination
  const [categories, count] = await Promise.all([
    categoryService.listCategories(filters, {
      order: { position: "ASC", name: "ASC" },
      skip: offset,
      take: limit,
    }),
    categoryService.listCategories(filters).then((cats) => cats.length),
  ])

  // If search is provided, filter by name
  let filteredCategories = categories
  if (search) {
    const searchLower = search.toLowerCase()
    filteredCategories = categories.filter(
      (cat: any) =>
        cat.name.toLowerCase().includes(searchLower) ||
        cat.slug.toLowerCase().includes(searchLower)
    )
  }

  res.json({
    categories: filteredCategories,
    count: search ? filteredCategories.length : count,
    offset,
    limit,
  })
}

// POST /admin/categories - Create new category
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const categoryService: CategoryModuleService = req.scope.resolve(CATEGORY_MODULE)

  // Validate request body
  const parseResult = categoryValidators.createCategory.safeParse(req.body)

  if (!parseResult.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parseResult.error.flatten().fieldErrors,
    })
    return
  }

  const input = parseResult.data

  // Generate slug if not provided
  const slug = input.slug || generateSlug(input.name)

  // Validate depth (max 2 levels)
  if (input.parent_id) {
    const depthValidation = await categoryService.validateDepth(input.parent_id)
    if (!depthValidation.valid) {
      res.status(400).json({ message: depthValidation.message })
      return
    }
  }

  // Validate slug uniqueness within brand scope
  const slugValidation = await categoryService.validateSlugUniqueness(
    slug,
    input.brand_id ?? null
  )
  if (!slugValidation.valid) {
    res.status(400).json({ message: slugValidation.message })
    return
  }

  // Get next position if not provided
  const position = input.position ?? await categoryService.getNextPosition(
    input.parent_id ?? null,
    input.brand_id ?? null
  )

  // Create category
  const category = await categoryService.createCategories({
    name: input.name,
    slug,
    description: input.description,
    image_url: input.image_url,
    parent_id: input.parent_id ?? null,
    brand_id: input.brand_id ?? null,
    position,
    is_active: input.is_active ?? true,
    metadata: input.metadata,
  })

  res.status(201).json({ category })
}
