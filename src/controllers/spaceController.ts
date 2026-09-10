import { Response, NextFunction } from 'express'
import mongoose from 'mongoose'
import Membership from '../models/Membership.js'
import Space, { ISpace } from '../models/Space.js'
import User from '../models/User.js'
import { AuthRequest } from '../middleware/authMiddleware.js'
import { SpaceRequest } from '../middleware/spaceAccess.js'
import {
  addMemberSchema,
  createSpaceSchema,
  updateMemberSchema,
  updateSpaceSchema,
} from '../validation/spaceValidation.js'

const serializeSpace = (
  space: ISpace | (ISpace & { _id: unknown }),
  role?: string,
) => ({
  id: String(space._id),
  name: space.name,
  type: space.type,
  ownerId: String(space.ownerId),
  role: role ?? null,
  createdAt: space.createdAt,
  updatedAt: space.updatedAt,
})

/** GET /api/spaces — every space the caller is an active member of. */
export const listMySpaces = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user!.id

    const memberships = await Membership.find({
      userId,
      status: 'ACTIVE',
    }).lean()

    const roleBySpace = new Map(
      memberships.map((m) => [String(m.spaceId), m.role]),
    )

    const spaces = await Space.find({
      _id: { $in: memberships.map((m) => m.spaceId) },
      deletedAt: null,
    }).lean()

    const payload = spaces
      .map((space) =>
        serializeSpace(
          space as unknown as ISpace,
          roleBySpace.get(String(space._id)),
        ),
      )
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'PERSONAL' ? -1 : 1
        return a.name.localeCompare(b.name)
      })

    return res.json({ success: true, spaces: payload })
  } catch (error) {
    next(error)
  }
}

/** POST /api/spaces — create a FAMILY space owned by the caller. */
export const createSpace = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = createSpaceSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid space data',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const userId = req.user!.id

    const space = await Space.create({
      name: result.data.name,
      type: 'FAMILY',
      ownerId: userId,
    })

    await Membership.create({
      spaceId: space._id,
      userId,
      role: 'OWNER',
      status: 'ACTIVE',
    })

    return res.status(201).json({
      success: true,
      message: 'Space created',
      space: serializeSpace(space, 'OWNER'),
    })
  } catch (error) {
    next(error)
  }
}

/** GET /api/spaces/:spaceId */
export const getSpace = async (req: SpaceRequest, res: Response) => {
  return res.json({
    success: true,
    space: serializeSpace(req.space!, req.membership!.role),
  })
}

/** PATCH /api/spaces/:spaceId — rename (owner only). */
export const updateSpace = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = updateSpaceSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid space data',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const space = req.space!
    space.name = result.data.name
    await space.save()

    return res.json({
      success: true,
      message: 'Space updated',
      space: serializeSpace(space, req.membership!.role),
    })
  } catch (error) {
    next(error)
  }
}

/** DELETE /api/spaces/:spaceId — soft-delete a FAMILY space (owner only). */
export const deleteSpace = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const space = req.space!

    if (space.type === 'PERSONAL') {
      return res.status(400).json({
        success: false,
        message: 'Your personal space cannot be deleted',
      })
    }

    space.deletedAt = new Date()
    await space.save()

    await Membership.updateMany(
      { spaceId: space._id, status: 'ACTIVE' },
      { $set: { status: 'REVOKED' } },
    )

    return res.json({ success: true, message: 'Space deleted' })
  } catch (error) {
    next(error)
  }
}

/** POST /api/spaces/:spaceId/leave — a non-owner member leaves a FAMILY space. */
export const leaveSpace = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const space = req.space!
    const membership = req.membership!

    if (space.type === 'PERSONAL') {
      return res.status(400).json({
        success: false,
        message: 'You cannot leave your personal space',
      })
    }

    if (membership.role === 'OWNER') {
      return res.status(400).json({
        success: false,
        message:
          'The owner cannot leave a space. Transfer ownership or delete it.',
      })
    }

    membership.status = 'REVOKED'
    await membership.save()

    return res.json({ success: true, message: 'You left the space' })
  } catch (error) {
    next(error)
  }
}

/** GET /api/spaces/:spaceId/members — active members (any member may view). */
export const listMembers = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const memberships = await Membership.find({
      spaceId: req.space!._id,
      status: 'ACTIVE',
    }).lean()

    const users = await User.find({
      _id: { $in: memberships.map((m) => m.userId) },
    })
      .select('username displayName')
      .lean()

    const userById = new Map(users.map((u) => [String(u._id), u]))

    const members = memberships.map((m) => {
      const user = userById.get(String(m.userId))
      return {
        userId: String(m.userId),
        username: user?.username ?? null,
        displayName: user?.displayName ?? null,
        role: m.role,
        joinedAt: m.createdAt,
      }
    })

    return res.json({ success: true, members })
  } catch (error) {
    next(error)
  }
}

/** POST /api/spaces/:spaceId/members — owner adds an existing user (FAMILY only). */
export const addMember = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = addMemberSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid member data',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const space = req.space!

    if (space.type === 'PERSONAL') {
      return res.status(400).json({
        success: false,
        message: 'Members cannot be added to a personal space',
      })
    }

    const { identifier, role } = result.data

    const user = await User.findOne({
      status: 'ACTIVE',
      $or: [
        { username: identifier },
        { email: identifier.toLowerCase() },
      ],
    })

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No Fico user matches that username or email',
      })
    }

    if (String(user._id) === req.user!.id) {
      return res.status(400).json({
        success: false,
        message: 'You are already the owner of this space',
      })
    }

    const existing = await Membership.findOne({
      spaceId: space._id,
      userId: user._id,
    })

    if (existing && existing.status === 'ACTIVE') {
      return res.status(409).json({
        success: false,
        message: 'That user is already a member',
      })
    }

    if (existing) {
      existing.status = 'ACTIVE'
      existing.role = role
      await existing.save()
    } else {
      await Membership.create({
        spaceId: space._id,
        userId: user._id,
        role,
        status: 'ACTIVE',
      })
    }

    return res.status(201).json({
      success: true,
      message: 'Member added',
      member: {
        userId: String(user._id),
        username: user.username,
        displayName: user.displayName ?? null,
        role,
      },
    })
  } catch (error) {
    next(error)
  }
}

/** PATCH /api/spaces/:spaceId/members/:userId — owner changes a member's role. */
export const updateMemberRole = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = updateMemberSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const userId = String(req.params.userId)

    if (userId === req.user!.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot change your own role',
      })
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(404).json({
        success: false,
        message: 'Member not found',
      })
    }

    const membership = await Membership.findOne({
      spaceId: req.space!._id,
      userId: new mongoose.Types.ObjectId(userId),
      status: 'ACTIVE',
    })

    if (!membership) {
      return res.status(404).json({
        success: false,
        message: 'Member not found',
      })
    }

    membership.role = result.data.role
    await membership.save()

    return res.json({
      success: true,
      message: 'Role updated',
      member: { userId, role: membership.role },
    })
  } catch (error) {
    next(error)
  }
}

/** DELETE /api/spaces/:spaceId/members/:userId — owner removes a member. */
export const removeMember = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = String(req.params.userId)

    if (userId === req.user!.id) {
      return res.status(400).json({
        success: false,
        message: 'Use "leave" or delete the space instead',
      })
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(404).json({
        success: false,
        message: 'Member not found',
      })
    }

    const membership = await Membership.findOne({
      spaceId: req.space!._id,
      userId: new mongoose.Types.ObjectId(userId),
      status: 'ACTIVE',
    })

    if (!membership) {
      return res.status(404).json({
        success: false,
        message: 'Member not found',
      })
    }

    membership.status = 'REVOKED'
    await membership.save()

    return res.json({ success: true, message: 'Member removed' })
  } catch (error) {
    next(error)
  }
}
