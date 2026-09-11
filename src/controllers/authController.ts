import { Request, Response, NextFunction } from 'express'
import User from '../models/User.js'
import Session from '../models/Session.js'
import Membership from '../models/Membership.js'
import Space from '../models/Space.js'
import {
  getDummyHash,
  hashPassword,
  verifyPassword,
} from '../utils/password.js'
import {
  generateSessionId,
  hashSessionId,
} from '../utils/session.js'
import {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  deleteAccountSchema,
  devResetPasswordSchema,
} from '../validation/authValidation.js'
import { AuthRequest } from '../middleware/authMiddleware.js'
import { createPersonalSpace } from '../services/spaceService.js'
import { consumePendingInvitations } from './spaceController.js'

const SESSION_DURATION_DAYS =
  Number(process.env.SESSION_DURATION_DAYS) || 7

const createSession = async (
  userId: string,
  res: Response,
  deviceId?: string,
): Promise<{ expiresAt: Date }> => {
  const sessionId = generateSessionId()
  const sessionHash = hashSessionId(sessionId)

  const expiresAt = new Date()

  expiresAt.setDate(
    expiresAt.getDate() + SESSION_DURATION_DAYS,
  )

  await Session.create({
    userId,
    sessionHash,
    ...(deviceId ? { deviceId } : {}),
    expiresAt,
    lastUsedAt: new Date(),
  })

  res.cookie('fico_session', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  })

  return { expiresAt }
}

export const register = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = registerSchema.safeParse(req.body)

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid registration data',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const { username, email, password, deviceId } = result.data

    const normalizedEmail = email.toLowerCase()

    const existingUser = await User.findOne({
      $or: [
        { username },
        { email: normalizedEmail },
      ],
    })

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Username or email is already in use',
      })
    }

    const passwordHash = await hashPassword(password)

    const user = await User.create({
      username,
      email: normalizedEmail,
      passwordHash,
      status: 'ACTIVE',
    })

    await createPersonalSpace(user.id)
    await consumePendingInvitations(user.id, normalizedEmail)

    const { expiresAt } = await createSession(user.id, res, deviceId)

    return res.status(201).json({
      success: true,
      message: 'Account created successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName ?? null,
      },
      session: {
        expiresAt: expiresAt.toISOString(),
      },
    })
  } catch (error) {
    next(error)
  }
}

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = loginSchema.safeParse(req.body)

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid login data',
      })
    }

    const { identifier, password, deviceId } = result.data

    const user = await User.findOne({
      $or: [
        { username: identifier },
        { email: identifier.toLowerCase() },
      ],
    })

    // Always run a verify — against a dummy hash when there's no user — so the
    // response time doesn't reveal whether an account exists.
    const passwordValid = await verifyPassword(
      password,
      user?.passwordHash ?? (await getDummyHash()),
    )

    if (!user || user.status !== 'ACTIVE' || !passwordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      })
    }

    const { expiresAt } = await createSession(user.id, res, deviceId)

    return res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName ?? null,
      },
      session: {
        expiresAt: expiresAt.toISOString(),
      },
    })
  } catch (error) {
    next(error)
  }
}

export const logout = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (req.sessionId) {
      await Session.updateOne(
        {
          sessionHash: hashSessionId(req.sessionId),
        },
        {
          $set: {
            revokedAt: new Date(),
          },
        },
      )
    }

    res.clearCookie('fico_session', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    })

    return res.json({
      success: true,
      message: 'Logged out successfully',
    })
  } catch (error) {
    next(error)
  }
}

export const getMe = async (
  req: AuthRequest,
  res: Response,
) => {
  return res.json({
    success: true,
    user: req.user,
    session: req.session,
  })
}

export const updateMe = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = updateProfileSchema.safeParse(req.body)

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid profile data',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const updates = result.data

    if (
      updates.username === undefined &&
      updates.email === undefined &&
      updates.displayName === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: 'No changes provided',
      })
    }

    const user = await User.findById(req.user?.id)

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      })
    }

    if (updates.username && updates.username !== user.username) {
      const existingUsername = await User.findOne({
        username: updates.username,
        _id: { $ne: user._id },
      })

      if (existingUsername) {
        return res.status(409).json({
          success: false,
          message: 'Username is already in use',
        })
      }

      user.username = updates.username
    }

    if (updates.displayName !== undefined) {
      user.displayName = updates.displayName || undefined
    }

    if (updates.email) {
      const normalizedEmail = updates.email.toLowerCase()

      if (normalizedEmail !== user.email) {
        const existingEmail = await User.findOne({
          email: normalizedEmail,
          _id: { $ne: user._id },
        })

        if (existingEmail) {
          return res.status(409).json({
            success: false,
            message: 'Email is already in use',
          })
        }

        user.email = normalizedEmail
      }
    }

    await user.save()

    return res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName ?? null,
      },
    })
  } catch (error) {
    next(error)
  }
}

export const deleteMe = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = deleteAccountSchema.safeParse(req.body)

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Password is required',
      })
    }

    const user = await User.findById(req.user?.id)

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      })
    }

    const passwordValid = await verifyPassword(
      result.data.password,
      user.passwordHash,
    )

    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password',
      })
    }

    await Session.updateMany(
      { userId: user._id },
      {
        $set: {
          revokedAt: new Date(),
        },
      },
    )

    // Revoke memberships and soft-delete any spaces this user owns.
    await Membership.updateMany(
      { userId: user._id, status: 'ACTIVE' },
      { $set: { status: 'REVOKED' } },
    )
    await Space.updateMany(
      { ownerId: user._id, deletedAt: null },
      { $set: { deletedAt: new Date() } },
    )

    // Soft-disable the account for now.
    user.status = 'DISABLED'
    await user.save()

    res.clearCookie('fico_session', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    })

    return res.json({
      success: true,
      message: 'Account deleted successfully',
    })
  } catch (error) {
    next(error)
  }
}

/**
 * TEMPORARY — POST /api/auth/dev-reset-password. No current password or
 * session required, which is the whole point (a locked-out account can't
 * supply either): it exists solely to recover from the Sept 2026 database
 * migration until real, email-based password reset ships. Delete this
 * handler, its route, its rate limiter, and `devResetPasswordSchema` once
 * that's in place — grep the codebase for "dev-reset-password" to find every
 * piece.
 */
export const devResetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ success: false, message: 'Not found' })
    }

    const result = devResetPasswordSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid data',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const { identifier, newPassword } = result.data

    const user = await User.findOne({
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

    user.passwordHash = await hashPassword(newPassword)
    await user.save()

    // Existing sessions were issued under the old password; revoke them so
    // this is a clean recovery, not a way to keep a stale session alive.
    await Session.updateMany(
      { userId: user._id },
      { $set: { revokedAt: new Date() } },
    )

    return res.json({
      success: true,
      message: `Password reset for ${user.username}. Log in with the new password.`,
    })
  } catch (error) {
    next(error)
  }
}