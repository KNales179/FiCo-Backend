import mongoose from 'mongoose'
import Category, { DEFAULT_CATEGORIES } from '../models/Category.js'

export const normalizeCategoryName = (name: string): string =>
  name.trim().toLowerCase().replace(/\s+/g, ' ')

/** Seed the default category list for a new space. Best-effort, idempotent. */
export const seedDefaultCategories = async (
  spaceId: string | mongoose.Types.ObjectId,
  userId: string | mongoose.Types.ObjectId,
): Promise<void> => {
  await Promise.all(
    DEFAULT_CATEGORIES.map((c) =>
      Category.updateOne(
        {
          spaceId,
          kind: c.kind,
          normalizedName: normalizeCategoryName(c.name),
        },
        {
          $setOnInsert: {
            spaceId,
            name: c.name,
            normalizedName: normalizeCategoryName(c.name),
            kind: c.kind,
            createdBy: userId,
          },
        },
        { upsert: true },
      ).catch(() => undefined),
    ),
  )
}

/** Resolve a category id to its current name (for snapshotting onto records). */
export const categoryNameById = async (
  categoryId: mongoose.Types.ObjectId | string | null | undefined,
): Promise<string | null> => {
  if (!categoryId || !mongoose.Types.ObjectId.isValid(String(categoryId))) {
    return null
  }
  const category = await Category.findById(categoryId)
  return category?.name ?? null
}
