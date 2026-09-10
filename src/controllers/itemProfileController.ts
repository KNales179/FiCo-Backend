import { NextFunction, Response } from 'express'
import { z } from 'zod'
import ItemProfile, { IItemProfile } from '../models/ItemProfile.js'
import PriceHistory from '../models/PriceHistory.js'
import { SpaceRequest } from '../middleware/spaceAccess.js'
import { suggestForName } from '../services/itemIntelligenceService.js'

const serialize = (p: IItemProfile) => ({
  id: String(p._id),
  normalizedName: p.normalizedName,
  displayName: p.displayName,
  category: p.category ?? null,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
})

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().max(60).nullable().optional(),
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
    if (result.data.category !== undefined) {
      profile.category = result.data.category
    }

    await profile.save()

    return res.json({
      success: true,
      message: 'Item updated',
      profile: serialize(profile),
    })
  } catch (error) {
    next(error)
  }
}
