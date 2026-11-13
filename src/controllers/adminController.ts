import { Response, NextFunction } from 'express'
import User, { displayBadges } from '../models/User.js'
import Session from '../models/Session.js'
import { hashPassword, verifyPassword } from '../utils/password.js'
import {
  adminResetTwoFactorSchema,
  adminSetPasswordSchema,
  adminSetRoleSchema,
} from '../validation/adminValidation.js'
import { AuthRequest } from '../middleware/authMiddleware.js'
import { logAdminAudit } from '../services/adminAuditService.js'
import { notifyUser, signOutEverywhere } from '../services/notificationService.js'

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
        emailVerified: u.emailVerified,
        avatarUrl: u.avatarUrl ?? null,
        badges: displayBadges(u),
        restricted: Boolean(u.restriction && (!u.restriction.until || u.restriction.until.getTime() > Date.now())),
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
    await signOutEverywhere(target.id, {
      code: 'ADMIN_PASSWORD_RESET',
      reason: result.data.reason || 'An admin set a new password for your account. Ask them for it, or use “Forgot password” to choose your own.',
    })

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

    await notifyUser({
      userId: target.id,
      kind: 'ADMIN_ACTION',
      title: result.data.role === 'ADMIN' ? 'You’re now a Fico admin' : 'Your admin access was removed',
      body:
        result.data.reason ||
        (result.data.role === 'ADMIN'
          ? 'You can now manage accounts and read reports from the Admin page in the menu. Use it kindly.'
          : 'Your account works exactly as before — just without the Admin page.'),
      senderName: 'Fico Admin Team',
      senderId: req.user!.id,
      popup: true,
    })

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
    session.revokedNotice = { code: 'ADMIN_SIGN_OUT', reason: null, until: null, at: new Date() }
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

/**
 * Turns off two-factor sign-in for someone who's locked out — lost their
 * phone and their backup codes. 2FA is optional for everyone, so this just
 * returns the account to password-only; they can set it up again any time.
 * Same step-up (the acting admin's own password) and audit trail as every
 * other action on another account, and every session of theirs is signed
 * out so the change can't be quietly ridden by whoever had the old device.
 */
export const resetUserTwoFactor = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = adminResetTwoFactorSchema.safeParse(req.body)
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
        detail: 'resetUserTwoFactor: wrong confirmation password',
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

    target.totpEnabled = false
    target.totpSecret = null
    target.totpBackupCodeHashes = []
    await target.save()

    await signOutEverywhere(target.id, {
      code: 'ADMIN_2FA_RESET',
      reason: result.data.reason || 'Two-step sign-in was turned off for your account, so you can sign in with just your password. You can turn it back on any time in Account.',
    })

    await logAdminAudit({
      actorId: req.user!.id,
      action: 'RESET_2FA',
      targetUserId: target.id,
      result: 'SUCCESS',
      detail: `2FA turned off for ${target.username}`,
    })

    return res.json({
      success: true,
      message: `Two-step sign-in turned off for ${target.username}. They can sign in with just their password now.`,
    })
  } catch (error) {
    next(error)
  }
}

