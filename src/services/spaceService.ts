import mongoose from 'mongoose'
import Membership from '../models/Membership.js'
import Space from '../models/Space.js'

/**
 * Creates a user's private PERSONAL space and their OWNER membership in it.
 * Every account has exactly one; it is created at registration and cannot be
 * left or deleted.
 */
export const createPersonalSpace = async (
  userId: string | mongoose.Types.ObjectId,
  displayName?: string,
) => {
  const space = await Space.create({
    name: displayName ? `${displayName}'s Space` : 'Personal',
    type: 'PERSONAL',
    ownerId: userId,
  })

  await Membership.create({
    spaceId: space._id,
    userId,
    role: 'OWNER',
    status: 'ACTIVE',
  })

  return space
}

/** Ensures the user has a PERSONAL space, creating one if missing. */
export const ensurePersonalSpace = async (
  userId: string | mongoose.Types.ObjectId,
) => {
  const existing = await Space.findOne({
    ownerId: userId,
    type: 'PERSONAL',
    deletedAt: null,
  })

  return existing ?? (await createPersonalSpace(userId))
}
