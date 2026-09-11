import crypto from 'crypto'
import { Request, Response, NextFunction } from 'express'
import User from '../models/User.js'
import Session from '../models/Session.js'
import TwoFactorChallenge from '../models/TwoFactorChallenge.js'
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
import { verifyTotp } from '../utils/totp.js'
import {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  deleteAccountSchema,
  changePasswordSchema,
  verifyTwoFactorSchema,
} from '../validation/authValidation.js'
import { AuthRequest } from '../middleware/authMiddleware.js'
import { createPersonalSpace } from '../services/spaceService.js'
import { consumePendingInvitations } from './spaceController.js'

const SESSION_DURATION_DAYS =
  Number(process.env.SESSION_DURATION_DAYS) || 7
/** How long a password-checked-out-but-2FA-pending login stays valid. */
const TWO_FACTOR_CHALLENGE_MINUTES = 5

const userAgentOf = (req: Request): string | null =>
  (req.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null

const createSession = async (
  userId: string,
  res: Response,
  deviceId?: string,
  userAgent?: string | null,
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
    ...(userAgent ? { userAgent } : {}),
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

/** Public shape of a user, for every auth response. */
const toPublicUser = (user: InstanceType<typeof User>) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  displayName: user.displayName ?? null,
  role: user.role,
  totpEnabled: user.totpEnabled,
})

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

    const { expiresAt } = await createSession(
      user.id,
      res,
      deviceId,
      userAgentOf(req),
    )

    return res.status(201).json({
      success: true,
      message: 'Account created successfully',
      user: toPublicUser(user),
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

    // The password checked out — an admin with 2FA turned on still needs a
    // code before a session is actually issued.
    if (user.role === 'ADMIN' && user.totpEnabled) {
      const pendingToken = generateSessionId()
      const expiresAt = new Date(
        Date.now() + TWO_FACTOR_CHALLENGE_MINUTES * 60 * 1000,
      )
      await TwoFactorChallenge.create({
        userId: user.id,
        tokenHash: hashSessionId(pendingToken),
        deviceId,
        userAgent: userAgentOf(req),
        expiresAt,
      })
      return res.json({
        success: true,
        requiresTwoFactor: true,
        pendingToken,
        message: 'Enter your authenticator code to finish signing in',
      })
    }

    const { expiresAt } = await createSession(
      user.id,
      res,
      deviceId,
      userAgentOf(req),
    )

    return res.json({
      success: true,
      message: 'Login successful',
      user: toPublicUser(user),
      session: {
        expiresAt: expiresAt.toISOString(),
      },
    })
  } catch (error) {
    next(error)
  }
}

/** Second step of login for an account with 2FA on — a TOTP code or a backup code. */
export const verifyTwoFactorLogin = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = verifyTwoFactorSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request',
      })
    }

    const { pendingToken, code, deviceId } = result.data
    const challenge = await TwoFactorChallenge.findOne({
      tokenHash: hashSessionId(pendingToken),
      expiresAt: { $gt: new Date() },
    })

    if (!challenge) {
      return res.status(401).json({
        success: false,
        message: 'That login attempt expired — sign in again',
      })
    }

    const user = await User.findById(challenge.userId).select(
      '+totpSecret +totpBackupCodeHashes',
    )

    if (!user || user.status !== 'ACTIVE' || !user.totpEnabled || !user.totpSecret) {
      await challenge.deleteOne()
      return res.status(401).json({
        success: false,
        message: 'Sign in again',
      })
    }

    const validTotp = verifyTotp(code, user.totpSecret)
    let usedBackupCodeHash: string | null = null

    if (!validTotp) {
      for (const hash of user.totpBackupCodeHashes) {
        if (await verifyPassword(code, hash)) {
          usedBackupCodeHash = hash
          break
        }
      }
    }

    if (!validTotp && !usedBackupCodeHash) {
      return res.status(401).json({
        success: false,
        message: 'Invalid code',
      })
    }

    // Single-use: the challenge is spent either way, and a backup code
    // that was just used comes off the list permanently.
    await challenge.deleteOne()
    if (usedBackupCodeHash) {
      user.totpBackupCodeHashes = user.totpBackupCodeHashes.filter(
        (h) => h !== usedBackupCodeHash,
      )
      await user.save()
    }

    const { expiresAt } = await createSession(
      user.id,
      res,
      deviceId ?? challenge.deviceId,
      userAgentOf(req) ?? challenge.userAgent,
    )

    return res.json({
      success: true,
      message: 'Login successful',
      user: toPublicUser(user),
      session: {
        expiresAt: expiresAt.toISOString(),
      },
      ...(usedBackupCodeHash
        ? { backupCodesRemaining: user.totpBackupCodeHashes.length }
        : {}),
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

/** Change your own password while already signed in — distinct from the
 *  still-deferred "forgot password" recovery flow, which needs an email
 *  service this app doesn't have yet. This one just needs the current one. */
export const changePassword = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = changePasswordSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const user = await User.findById(req.user?.id)
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    const valid = await verifyPassword(
      result.data.currentPassword,
      user.passwordHash,
    )
    if (!valid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect',
      })
    }

    user.passwordHash = await hashPassword(result.data.newPassword)
    await user.save()

    return res.json({
      success: true,
      message: 'Password changed',
    })
  } catch (error) {
    next(error)
  }
}

/** Device recognition: every non-expired session on your own account. */
export const listMySessions = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const sessions = await Session.find({
      userId: req.user?.id,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).sort({ lastUsedAt: -1 })

    const currentHash = req.sessionId ? hashSessionId(req.sessionId) : null

    return res.json({
      success: true,
      sessions: sessions.map((s) => ({
        id: s.id,
        deviceId: s.deviceId ?? null,
        userAgent: s.userAgent ?? null,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        isCurrent: s.sessionHash === currentHash,
      })),
    })
  } catch (error) {
    next(error)
  }
}

/** Revoke one of your own devices — "I don't recognize this, log it out." */
export const revokeMySession = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const session = await Session.findOne({
      _id: req.params.sessionId,
      userId: req.user?.id,
    })

    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' })
    }

    session.revokedAt = new Date()
    await session.save()

    return res.json({ success: true, message: 'Device signed out' })
  } catch (error) {
    next(error)
  }
}
