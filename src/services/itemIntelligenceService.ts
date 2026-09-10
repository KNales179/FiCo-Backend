import mongoose from 'mongoose'
import ItemProfile, { IItemProfile } from '../models/ItemProfile.js'
import PriceHistory from '../models/PriceHistory.js'

/** Lowercase, trim, collapse internal whitespace. Stable matching key. */
export const normalizeItemName = (name: string): string =>
  name.trim().toLowerCase().replace(/\s+/g, ' ')

/** Find the profile for a name in a space, creating it on first sight. */
export const resolveItemProfile = async (
  spaceId: mongoose.Types.ObjectId,
  name: string,
): Promise<IItemProfile> => {
  const normalizedName = normalizeItemName(name)

  const existing = await ItemProfile.findOne({ spaceId, normalizedName })
  if (existing) return existing

  try {
    return await ItemProfile.create({
      spaceId,
      normalizedName,
      displayName: name.trim(),
    })
  } catch {
    // Lost a race — the unique index rejected the duplicate; re-read.
    return (await ItemProfile.findOne({ spaceId, normalizedName }))!
  }
}

export interface ItemSuggestion {
  itemProfileId: string
  displayName: string
  category: string | null
  lastPriceMinor: number | null
  lastPurchasedAt: Date | null
  priceCount: number
}

/** What Fico knows about an item the user is about to add (Product Spec §9, §10). */
export const suggestForName = async (
  spaceId: mongoose.Types.ObjectId,
  name: string,
): Promise<ItemSuggestion | null> => {
  const normalizedName = normalizeItemName(name)
  const profile = await ItemProfile.findOne({ spaceId, normalizedName })
  if (!profile) return null

  const [latest, count] = await Promise.all([
    PriceHistory.findOne({ itemProfileId: profile._id }).sort({
      purchasedAt: -1,
    }),
    PriceHistory.countDocuments({ itemProfileId: profile._id }),
  ])

  return {
    itemProfileId: String(profile._id),
    displayName: profile.displayName,
    category: profile.category ?? null,
    lastPriceMinor: latest?.amountMinor ?? null,
    lastPurchasedAt: latest?.purchasedAt ?? null,
    priceCount: count,
  }
}

/** Record what an item actually cost, to sharpen future suggestions. */
export const recordPurchasePrice = async (params: {
  spaceId: mongoose.Types.ObjectId
  itemProfileId: mongoose.Types.ObjectId
  amountMinor: number
  purchasedAt: Date
  transactionId?: mongoose.Types.ObjectId | null
}): Promise<void> => {
  await PriceHistory.create({
    spaceId: params.spaceId,
    itemProfileId: params.itemProfileId,
    amountMinor: params.amountMinor,
    purchasedAt: params.purchasedAt,
    transactionId: params.transactionId ?? null,
  })
}
