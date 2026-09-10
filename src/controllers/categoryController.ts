import { NextFunction, Response } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import Category, { ICategory } from '../models/Category.js'
import { SpaceRequest } from '../middleware/spaceAccess.js'
import { normalizeCategoryName } from '../services/categoryService.js'

const serialize = (c: ICategory) => ({
  id: String(c._id),
  name: c.name,
  kind: c.kind,
  archived: c.archived,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
})

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(40),
  kind: z.enum(['EXPENSE', 'INCOME']).default('EXPENSE'),
})

const updateSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  archived: z.boolean().optional(),
})

/** GET /api/spaces/:spaceId/categories  (?kind=EXPENSE|INCOME, ?includeArchived) */
export const listCategories = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const filter: Record<string, unknown> = {
      spaceId: req.space!._id,
      deletedAt: null,
    }
    if (req.query.kind === 'EXPENSE' || req.query.kind === 'INCOME') {
      filter.kind = req.query.kind
    }
    if (req.query.includeArchived !== 'true') {
      filter.archived = false
    }

    const categories = await Category.find(filter).sort({ name: 1 })
    return res.json({
      success: true,
      categories: categories.map(serialize),
    })
  } catch (error) {
    next(error)
  }
}

/** POST /api/spaces/:spaceId/categories */
export const createCategory = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = createSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category data',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const normalizedName = normalizeCategoryName(result.data.name)

    const existing = await Category.findOne({
      spaceId: req.space!._id,
      kind: result.data.kind,
      normalizedName,
      deletedAt: null,
    })
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'That category already exists',
      })
    }

    const category = await Category.create({
      spaceId: req.space!._id,
      name: result.data.name,
      normalizedName,
      kind: result.data.kind,
      createdBy: req.user!.id,
    })

    return res.status(201).json({
      success: true,
      message: 'Category created',
      category: serialize(category),
    })
  } catch (error) {
    next(error)
  }
}

/** PATCH /api/spaces/:spaceId/categories/:categoryId — rename / archive. */
export const updateCategory = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = updateSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category data',
      })
    }

    const id = String(req.params.categoryId)
    const category = await Category.findOne({
      _id: mongoose.Types.ObjectId.isValid(id) ? id : null,
      spaceId: req.space!._id,
      deletedAt: null,
    })
    if (!category) {
      return res
        .status(404)
        .json({ success: false, message: 'Category not found' })
    }

    if (result.data.name !== undefined) {
      category.name = result.data.name
      category.normalizedName = normalizeCategoryName(result.data.name)
    }
    if (result.data.archived !== undefined) {
      category.archived = result.data.archived
    }

    await category.save()
    return res.json({
      success: true,
      message: 'Category updated',
      category: serialize(category),
    })
  } catch (error) {
    next(error)
  }
}

/** DELETE /api/spaces/:spaceId/categories/:categoryId — soft delete (records keep their name snapshot). */
export const deleteCategory = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = String(req.params.categoryId)
    const category = await Category.findOne({
      _id: mongoose.Types.ObjectId.isValid(id) ? id : null,
      spaceId: req.space!._id,
      deletedAt: null,
    })
    if (!category) {
      return res
        .status(404)
        .json({ success: false, message: 'Category not found' })
    }

    category.deletedAt = new Date()
    await category.save()
    return res.json({ success: true, message: 'Category deleted' })
  } catch (error) {
    next(error)
  }
}
