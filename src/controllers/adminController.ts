import { Response, NextFunction } from 'express'
import User from '../models/User.js'
import Session from '../models/Session.js'
import { hashPassword, verifyPassword } from '../utils/password.js'
import {
  adminSetPasswordSchema,
  adminSetRoleSchema,
} from '../validation/adminValidation.js'
import { AuthRequest } from '../middleware/authMiddleware.js'
import { logAdminAudit } from '../services/adminAuditService.js'

/**
 * Re-checks the *acting admin's own* current password — every sensitive
 * admin action on someone else's account asks for this, same reasoning as
 * `deleteMe` asking a person to re-confirm their own password on their own
 * account: a hijacked-but-not-fully-compromised session can't do lasting
 * damage to another user's account silently.
 */
const confirmActingAdmin = async (
  req: AuthRequest,
  confirmPassword: string,
): Promise<boolean> => {
  const admin = await User.findById(req.user?.id)
  if (!admin) return false
  return verifyPassword(confirmPassword, admin.passwordHash)
}

export const listUsers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const users = await User.find().sort({ createdAt: 1 })
    return res.json({
      success: true,
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        displayName: u.displayName ?? null,
        status: u.status,
        role: u.role,
        totpEnabled: u.totpEnabled,
        createdAt: u.createdAt.toISOString(),
        isSelf: u.id === req.user?.id,
      })),
    })
  } catch (error) {
    next(error)
  }
}

export const setUserPassword = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = adminSetPasswordSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request',
        errors: result.error.flatten().fieldErrors,
      })
    }

    if (!(await confirmActingAdmin(req, result.data.confirmPassword))) {
      await logAdminAudit({
        actorId: req.user!.id,
        action: 'STEP_UP_FAILED',
        targetUserId: String(req.params.userId),
        result: 'FAILURE',
        detail: 'setUserPassword: wrong confirmation password',
      })
      return res.status(401).json({
        success: false,
        message: "That's not your current password",
      })
    }

    const target = await User.findById(req.params.userId)
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    target.passwordHash = await hashPassword(result.data.newPassword)
    await target.save()

    // A password set out from under someone is exactly when every other
    // device should have to sign in again.
    await Session.updateMany(
      { userId: target.id },
      { $set: { revokedAt: new Date() } },
    )

    await logAdminAudit({
      actorId: req.user!.id,
      action: 'SET_PASSWORD',
      targetUserId: target.id,
      result: 'SUCCESS',
      detail: `password changed for ${target.username}`,
    })

    return res.json({
      success: true,
      message: `Password changed for ${target.username}`,
    })
  } catch (error) {
    next(error)
  }
}

export const setUserRole = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = adminSetRoleSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request',
        errors: result.error.flatten().fieldErrors,
      })
    }

    if (!(await confirmActingAdmin(req, result.data.confirmPassword))) {
      await logAdminAudit({
        actorId: req.user!.id,
        action: 'STEP_UP_FAILED',
        targetUserId: String(req.params.userId),
        result: 'FAILURE',
        detail: 'setUserRole: wrong confirmation password',
      })
      return res.status(401).json({
        success: false,
        message: "That's not your current password",
      })
    }

    const target = await User.findById(req.params.userId)
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    if (target.role === 'ADMIN' && result.data.role === 'USER') {
      const adminCount = await User.countDocuments({ role: 'ADMIN' })
      if (adminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: 'At least one admin has to remain — appoint another first',
        })
      }
    }

    target.role = result.data.role
    await target.save()

    await logAdminAudit({
      actorId: req.user!.id,
      action: 'SET_ROLE',
      targetUserId: target.id,
      result: 'SUCCESS',
      detail: `${target.username} set to ${result.data.role}`,
    })

    return res.json({
      success: true,
      message: `${target.username} is now ${result.data.role === 'ADMIN' ? 'an admin' : 'a regular user'}`,
    })
  } catch (error) {
    next(error)
  }
}

export const listUserSessions = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const target = await User.findById(req.params.userId)
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    const sessions = await Session.find({
      userId: target.id,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).sort({ lastUsedAt: -1 })

    return res.json({
      success: true,
      sessions: sessions.map((s) => ({
        id: s.id,
        deviceId: s.deviceId ?? null,
        userAgent: s.userAgent ?? null,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
      })),
    })
  } catch (error) {
    next(error)
  }
}

export const revokeUserSession = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const session = await Session.findOne({
      _id: req.params.sessionId,
      userId: req.params.userId,
    })

    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' })
    }

    session.revokedAt = new Date()
    await session.save()

    await logAdminAudit({
      actorId: req.user!.id,
      action: 'REVOKE_SESSION',
      targetUserId: String(req.params.userId),
      result: 'SUCCESS',
      detail: session.deviceId ? `device ${session.deviceId}` : null,
    })

    return res.json({ success: true, message: 'Device signed out' })
  } catch (error) {
    next(error)
  }
}
