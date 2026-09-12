import { Response, NextFunction } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import Invitation from '../models/Invitation.js'
import Membership from '../models/Membership.js'
import Space, { ISpace } from '../models/Space.js'
import User from '../models/User.js'
import { AuthRequest } from '../middleware/authMiddleware.js'
import { SpaceRequest } from '../middleware/spaceAccess.js'
import { seedDefaultCategories } from '../services/categoryService.js'
import { logAction } from '../services/actionLogService.js'
import {
  addMemberSchema,
  createSpaceSchema,
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

    await seedDefaultCategories(
      space._id as mongoose.Types.ObjectId,
      userId,
    )

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

    await logAction({
      spaceId: space._id,
      actorId: req.user!.id,
      action: 'MEMBER_REMOVE',
      entityType: 'membership',
      entityId: req.user!.id,
      summary: `${req.user!.username} left the space`,
    })

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
      .select('username displayName avatarUrl')
      .lean()

    const userById = new Map(users.map((u) => [String(u._id), u]))

    const members = memberships.map((m) => {
      const user = userById.get(String(m.userId))
      return {
        userId: String(m.userId),
        username: user?.username ?? null,
        displayName: user?.displayName ?? null,
        avatarUrl: user?.avatarUrl ?? null,
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

    const { identifier } = result.data

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
      existing.role = 'MEMBER'
      await existing.save()
    } else {
      try {
        await Membership.create({
          spaceId: space._id,
          userId: user._id,
          role: 'MEMBER',
          status: 'ACTIVE',
        })
      } catch (createError) {
        // Lost the race on the unique (spaceId, userId) index — someone
        // else added this same user a moment ago. Reactivate that row
        // instead of surfacing a raw duplicate-key error for something
        // that isn't really a conflict from the caller's point of view.
        const raced = await Membership.findOne({
          spaceId: space._id,
          userId: user._id,
        })
        if (!raced) throw createError
        raced.status = 'ACTIVE'
        raced.role = 'MEMBER'
        await raced.save()
      }
    }

    await logAction({
      spaceId: space._id,
      actorId: req.user!.id,
      action: 'MEMBER_ADD',
      entityType: 'membership',
      entityId: String(user._id),
      summary: `added ${user.username} to the Finance`,
    })

    return res.status(201).json({
      success: true,
      message: 'Member added',
      member: {
        userId: String(user._id),
        username: user.username,
        displayName: user.displayName ?? null,
        role: 'MEMBER',
      },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * POST /api/spaces/:spaceId/transfer-ownership — the current owner hands the
 * Finance to another active member. The old owner stays on as a normal member.
 */
export const transferOwnership = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = z
      .object({ userId: z.string().trim().min(1) })
      .safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'A member to transfer ownership to is required',
      })
    }

    const targetUserId = result.data.userId

    if (targetUserId === req.user!.id) {
      return res.status(400).json({
        success: false,
        message: 'You already own this Finance',
      })
    }

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res
        .status(404)
        .json({ success: false, message: 'Member not found' })
    }

    const space = req.space!

    const targetMembership = await Membership.findOne({
      spaceId: space._id,
      userId: new mongoose.Types.ObjectId(targetUserId),
      status: 'ACTIVE',
    })
    if (!targetMembership) {
      return res
        .status(404)
        .json({ success: false, message: 'Member not found' })
    }

    const ownerMembership = req.membership!

    targetMembership.role = 'OWNER'
    ownerMembership.role = 'MEMBER'
    space.ownerId = new mongoose.Types.ObjectId(targetUserId)

    await Promise.all([
      targetMembership.save(),
      ownerMembership.save(),
      space.save(),
    ])

    const newOwner = await User.findById(targetUserId).select('username')

    await logAction({
      spaceId: space._id,
      actorId: req.user!.id,
      action: 'OWNERSHIP_TRANSFER',
      entityType: 'space',
      entityId: String(space._id),
      summary: `transferred ownership to ${newOwner?.username ?? 'another member'}`,
      oldValue: req.user!.id,
      newValue: targetUserId,
    })

    return res.json({
      success: true,
      message: 'Ownership transferred',
      ownerId: targetUserId,
    })
  } catch (error) {
    next(error)
  }
}

// ---------------------------------------------------------------------------
// Invitations (for people who don't have a Fico account yet)
// ---------------------------------------------------------------------------

const inviteSchema = z.object({
  email: z.string().trim().email().max(100),
})

const serializeInvitation = (inv: {
  _id: unknown
  email: string
  status: string
  expiresAt: Date
  createdAt: Date
}) => ({
  id: String(inv._id),
  email: inv.email,
  status: inv.status,
  expiresAt: inv.expiresAt,
  createdAt: inv.createdAt,
})

/** GET /api/spaces/:spaceId/invitations — pending invites (owner). */
export const listInvitations = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const invitations = await Invitation.find({
      spaceId: req.space!._id,
      status: 'PENDING',
    }).sort({ createdAt: -1 })

    return res.json({
      success: true,
      invitations: invitations.map(serializeInvitation),
    })
  } catch (error) {
    next(error)
  }
}

/** POST /api/spaces/:spaceId/invitations — invite by email (owner, FAMILY only). */
export const createInvitation = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = inviteSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'A valid email is required',
      })
    }

    const space = req.space!
    if (space.type === 'PERSONAL') {
      return res.status(400).json({
        success: false,
        message: 'You cannot invite people to a personal space',
      })
    }

    const email = result.data.email.toLowerCase()

    // Already a Fico user? Add them directly.
    const user = await User.findOne({ email, status: 'ACTIVE' })
    if (user) {
      if (String(user._id) === req.user!.id) {
        return res.status(400).json({
          success: false,
          message: 'You are already in this space',
        })
      }
      const existing = await Membership.findOne({
        spaceId: space._id,
        userId: user._id,
      })
      if (existing && existing.status === 'ACTIVE') {
        return res.status(409).json({
          success: false,
          message: 'That person is already a member',
        })
      }
      if (existing) {
        existing.status = 'ACTIVE'
        existing.role = 'MEMBER'
        await existing.save()
      } else {
        await Membership.create({
          spaceId: space._id,
          userId: user._id,
          role: 'MEMBER',
          status: 'ACTIVE',
        })
      }
      await logAction({
        spaceId: space._id,
        actorId: req.user!.id,
        action: 'MEMBER_ADD',
        entityType: 'membership',
        entityId: String(user._id),
        summary: `added ${user.username} to the Finance`,
      })
      return res.status(201).json({
        success: true,
        message: 'Member added',
        addedExistingUser: true,
      })
    }

    // Otherwise leave a pending invitation they redeem on sign-up.
    const pending = await Invitation.findOne({
      spaceId: space._id,
      email,
      status: 'PENDING',
    })
    if (!pending) {
      await Invitation.create({
        spaceId: space._id,
        email,
        invitedBy: req.user!.id,
      })
    }

    await logAction({
      spaceId: space._id,
      actorId: req.user!.id,
      action: 'INVITE',
      entityType: 'invitation',
      entityId: email,
      summary: `invited ${email} to the Finance`,
    })

    return res.status(201).json({
      success: true,
      message: `Invitation sent to ${email}. They'll join when they sign up.`,
      addedExistingUser: false,
    })
  } catch (error) {
    next(error)
  }
}

/** DELETE /api/spaces/:spaceId/invitations/:invitationId — revoke (owner). */
export const revokeInvitation = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = String(req.params.invitationId)
    const invitation = await Invitation.findOne({
      _id: mongoose.Types.ObjectId.isValid(id) ? id : null,
      spaceId: req.space!._id,
      status: 'PENDING',
    })
    if (!invitation) {
      return res
        .status(404)
        .json({ success: false, message: 'Invitation not found' })
    }
    invitation.status = 'REVOKED'
    await invitation.save()
    return res.json({ success: true, message: 'Invitation revoked' })
  } catch (error) {
    next(error)
  }
}

/**
 * Turn any pending invitations for `email` into active memberships. Called on
 * registration so an invited person lands straight in the shared space.
 */
export const consumePendingInvitations = async (
  userId: mongoose.Types.ObjectId | string,
  email: string,
): Promise<void> => {
  const pending = await Invitation.find({
    email: email.toLowerCase(),
    status: 'PENDING',
    expiresAt: { $gt: new Date() },
  })

  for (const invitation of pending) {
    const space = await Space.findOne({
      _id: invitation.spaceId,
      deletedAt: null,
    })
    if (!space) {
      invitation.status = 'REVOKED'
      await invitation.save()
      continue
    }

    await Membership.updateOne(
      { spaceId: invitation.spaceId, userId },
      {
        $setOnInsert: {
          spaceId: invitation.spaceId,
          userId,
          role: 'MEMBER',
          status: 'ACTIVE',
        },
      },
      { upsert: true },
    )

    invitation.status = 'ACCEPTED'
    invitation.acceptedBy = new mongoose.Types.ObjectId(String(userId))
    await invitation.save()

    await logAction({
      spaceId: invitation.spaceId,
      actorId: userId,
      action: 'MEMBER_ADD',
      entityType: 'membership',
      entityId: String(userId),
      summary: `${email} joined the space via an invitation`,
    })
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

    await logAction({
      spaceId: req.space!._id,
      actorId: req.user!.id,
      action: 'MEMBER_REMOVE',
      entityType: 'membership',
      entityId: userId,
      summary: 'removed a member from the space',
    })

    return res.json({ success: true, message: 'Member removed' })
  } catch (error) {
    next(error)
  }
}
