import { NextFunction, Response } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import Category from '../models/Category.js'
import ItemProfile, { IItemProfile } from '../models/ItemProfile.js'
import PriceHistory from '../models/PriceHistory.js'
import { SpaceRequest } from '../middleware/spaceAccess.js'
import { categoryNameById } from '../services/categoryService.js'
import { suggestForName } from '../services/itemIntelligenceService.js'

const serialize = (p: IItemProfile) => ({
  id: String(p._id),
  normalizedName: p.normalizedName,
  displayName: p.displayName,
  categoryId: p.categoryId ? String(p.categoryId) : null,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
})

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  categoryId: z.string().trim().min(1).nullable().optional(),
})

/** GET /api/spaces/:spaceId/item-profiles */
export const listItemProfiles = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const profiles = await ItemProfile.find({
      spaceId: req.space!._id,
    }).sort({ displayName: 1 })

    return res.json({
      success: true,
      profiles: profiles.map(serialize),
    })
  } catch (error) {
    next(error)
  }
}

/** GET /api/spaces/:spaceId/item-profiles/suggest?name=... */
export const suggestItem = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const name = typeof req.query.name === 'string' ? req.query.name : ''
    if (!name.trim()) {
      return res.json({ success: true, suggestion: null })
    }

    const suggestion = await suggestForName(req.space!._id, name)
    return res.json({ success: true, suggestion })
  } catch (error) {
    next(error)
  }
}

/** GET /api/spaces/:spaceId/item-profiles/:profileId/prices */
export const itemPriceHistory = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const profile = await ItemProfile.findOne({
      _id: req.params.profileId,
      spaceId: req.space!._id,
    }).catch(() => null)

    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: 'Item not found' })
    }

    const prices = await PriceHistory.find({
      itemProfileId: profile._id,
    })
      .sort({ purchasedAt: -1 })
      .limit(50)

    return res.json({
      success: true,
      profile: serialize(profile),
      prices: prices.map((p) => ({
        amountMinor: p.amountMinor,
        purchasedAt: p.purchasedAt,
        transactionId: p.transactionId ? String(p.transactionId) : null,
      })),
    })
  } catch (error) {
    next(error)
  }
}

/**
 * PATCH /api/spaces/:spaceId/item-profiles/:profileId
 * Changing the category affects only *future* purchases — past transactions
 * keep the category they were recorded with (Product Spec §10).
 */
export const updateItemProfile = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = updateSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid item data',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const profile = await ItemProfile.findOne({
      _id: req.params.profileId,
      spaceId: req.space!._id,
    }).catch(() => null)

    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: 'Item not found' })
    }

    if (result.data.displayName !== undefined) {
      profile.displayName = result.data.displayName
    }
    if (result.data.categoryId !== undefined) {
      if (result.data.categoryId === null) {
        profile.categoryId = null
      } else {
        const category = await Category.findOne({
          _id: mongoose.Types.ObjectId.isValid(result.data.categoryId)
            ? result.data.categoryId
            : null,
          spaceId: req.space!._id,
          deletedAt: null,
        })
        if (!category) {
          return res
            .status(422)
            .json({ success: false, message: 'Unknown category' })
        }
        profile.categoryId = category._id as mongoose.Types.ObjectId
      }
    }

    await profile.save()

    return res.json({
      success: true,
      message: 'Item updated',
      profile: {
        ...serialize(profile),
        category: await categoryNameById(profile.categoryId),
      },
    })
  } catch (error) {
    next(error)
  }
}
