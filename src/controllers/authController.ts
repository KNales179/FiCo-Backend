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
  sessionCookieOptions,
} from '../utils/session.js'
import { verifyTotp } from '../utils/totp.js'
import { OAuth2Client } from 'google-auth-library'
import { deleteAvatar, uploadAvatar } from '../services/attachmentStorage.js'
import { generateToken, hashToken } from '../utils/token.js'
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from '../services/emailService.js'
import {
  registerSchema,
  loginSchema,
  googleAuthSchema,
  updateProfileSchema,
  deleteAccountSchema,
  changePasswordSchema,
  verifyTwoFactorSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  notificationPreferencesSchema,
} from '../validation/authValidation.js'
import { AuthRequest, isRestricted, noticeMessage, restrictedResponse } from '../middleware/authMiddleware.js'
import { createPersonalSpace } from '../services/spaceService.js'
import { consumePendingInvitations } from './spaceController.js'

const SESSION_DURATION_DAYS =
  Number(process.env.SESSION_DURATION_DAYS) || 7
/** How long a password-checked-out-but-2FA-pending login stays valid. */
const TWO_FACTOR_CHALLENGE_MINUTES = 5
const EMAIL_VERIFICATION_HOURS = 24
const PASSWORD_RESET_MINUTES = 60

/** Generic response either way — never reveals whether an account exists. */
const FORGOT_PASSWORD_MESSAGE =
  "If an account matches that, we've sent an email with instructions."

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
    ...sessionCookieOptions(),
    expires: expiresAt,
  })

  return { expiresAt }
}

/** Public shape of a user, for every auth response. */
const toPublicUser = (user: InstanceType<typeof User>) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  displayName: user.displayName ?? null,
  birthday: user.birthday?.month
    ? { month: user.birthday.month, day: user.birthday.day, year: user.birthday.year ?? null }
    : null,
  paydays: user.paydays ?? [],
  role: user.role,
  totpEnabled: user.totpEnabled,
  emailVerified: user.emailVerified,
  avatarUrl: user.avatarUrl ?? null,
  notificationPreferences: user.notificationPreferences,
})

/**
 * Generates a fresh verification token, saves its hash (never the token
 * itself — a database leak alone should never hand out a working link),
 * and emails it. Shared by `register` and `resendVerificationEmail`.
 */
const issueEmailVerification = async (
  user: InstanceType<typeof User>,
): Promise<void> => {
  const token = generateToken()
  user.emailVerificationTokenHash = hashToken(token)
  user.emailVerificationExpiresAt = new Date(
    Date.now() + EMAIL_VERIFICATION_HOURS * 60 * 60 * 1000,
  )
  await user.save()
  await sendVerificationEmail(user.email, user.displayName || user.username, token)
}

export const register = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = registerSchema.safeParse(req.body)

    if (!result.success) {
      // Say exactly what's wrong (and with which field) instead of a
      // generic "invalid data" — people couldn't tell why sign-up failed.
      const fieldErrors = result.error.flatten().fieldErrors
      const first = Object.values(fieldErrors).flat().find(Boolean)
      return res.status(400).json({
        success: false,
        message: first ?? 'Please check the highlighted fields',
        errors: fieldErrors,
      })
    }

    const { username, email, password, deviceId } = result.data
    // registerSchema requires this to be the literal `true` — reaching here
    // means it was actually agreed to, not just present.

    const normalizedEmail = email.toLowerCase()

    const existingUser = await User.findOne({
      $or: [
        { username },
        { email: normalizedEmail },
      ],
    })

    if (existingUser) {
      const emailTaken = existingUser.email === normalizedEmail
      return res.status(409).json({
        success: false,
        message: emailTaken
          ? 'That email already has a Fico account — try signing in, or reset your password.'
          : 'That username is taken — try another one.',
        errors: emailTaken
          ? { email: ['That email already has a Fico account'] }
          : { username: ['That username is taken'] },
      })
    }

    const passwordHash = await hashPassword(password)

    const user = await User.create({
      username,
      email: normalizedEmail,
      passwordHash,
      status: 'ACTIVE',
      termsAcceptedAt: new Date(),
    })

    await createPersonalSpace(user.id)
    await consumePendingInvitations(user.id, normalizedEmail)

    // Best effort — a person can always ask for the email again from
    // Account, and a stalled/misconfigured email provider must never block
    // account creation itself.
    void issueEmailVerification(user).catch((error) => {
      console.error('[fico/api] Could not send verification email:', error)
    })

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

    // Only once the password is right does Fico say *why* an account can't
    // sign in — never to someone guessing.
    if (user && passwordValid && isRestricted(user.restriction)) {
      return res.status(403).json(restrictedResponse(user.restriction!))
    }
    if (user && passwordValid && user.status !== 'ACTIVE' && user.deletedByAdmin) {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_DELETED',
        message: noticeMessage('ACCOUNT_DELETED'),
        notice: {
          code: 'ACCOUNT_DELETED',
          reason: user.deletedByAdmin.reason,
          until: null,
          at: user.deletedByAdmin.at.toISOString(),
        },
      })
    }

    if (!user || user.status !== 'ACTIVE' || !passwordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      })
    }

    // The password checked out — anyone who turned 2FA on (it's optional,
    // for every account) still needs a code before a session is issued.
    if (user.totpEnabled) {
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

    res.clearCookie('fico_session', sessionCookieOptions())

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
      const fieldErrors = result.error.flatten().fieldErrors
      return res.status(400).json({
        success: false,
        message: Object.values(fieldErrors).flat().find(Boolean) ?? 'Invalid profile data',
        errors: fieldErrors,
      })
    }

    const updates = result.data

    if (
      updates.username === undefined &&
      updates.email === undefined &&
      updates.displayName === undefined &&
      updates.birthday === undefined &&
      updates.paydays === undefined
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

    if (updates.birthday !== undefined) {
      user.birthday = updates.birthday
        ? { month: updates.birthday.month, day: updates.birthday.day, year: updates.birthday.year ?? null }
        : undefined
    }

    if (updates.paydays !== undefined) {
      user.paydays = [...new Set(updates.paydays)].sort((a, b) => a - b)
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

/** Settings page — mute/unmute specific push notification categories. */
export const updateNotificationPreferences = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = notificationPreferencesSchema.safeParse(req.body)
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

    user.notificationPreferences = {
      ...user.notificationPreferences,
      ...result.data,
    }
    await user.save()

    return res.json({
      success: true,
      message: 'Notification preferences updated',
      notificationPreferences: user.notificationPreferences,
    })
  } catch (error) {
    next(error)
  }
}

/** Account/Settings page — a profile picture, visible to fellow space members. */
export const uploadMyAvatar = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const file = (req as AuthRequest & { file?: { buffer: Buffer; mimetype: string } })
      .file
    if (!file) {
      return res.status(400).json({ success: false, message: 'No image provided' })
    }

    // avatarPublicId is `select: false` (it's Cloudinary bookkeeping, not
    // something any API response should ever include) — it has to be
    // opted back in explicitly here, or the previous asset can never be
    // found to delete on a replace.
    const user = await User.findById(req.user?.id).select('+avatarPublicId')
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    const previousPublicId = user.avatarPublicId
    const uploaded = await uploadAvatar(file.buffer, file.mimetype)

    user.avatarUrl = uploaded.url
    user.avatarPublicId = uploaded.publicId
    await user.save()

    if (previousPublicId) {
      await deleteAvatar(previousPublicId)
    }

    return res.json({ success: true, avatarUrl: user.avatarUrl })
  } catch (error) {
    next(error)
  }
}

export const deleteMyAvatar = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = await User.findById(req.user?.id).select('+avatarPublicId')
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    if (user.avatarPublicId) {
      await deleteAvatar(user.avatarPublicId)
    }
    user.avatarUrl = null
    user.avatarPublicId = null
    await user.save()

    return res.json({ success: true, message: 'Profile picture removed' })
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

    res.clearCookie('fico_session', sessionCookieOptions())

    return res.json({
      success: true,
      message: 'Account deleted successfully',
    })
  } catch (error) {
    next(error)
  }
}

/** Change your own password while already signed in — needs the current
 *  one. `forgotPassword`/`resetPassword` below are the recovery path for
 *  when you don't have that. */
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

/** Ask again — the earlier link expired, or the email never arrived. */
export const resendVerificationEmail = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = await User.findById(req.user?.id)
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    if (user.emailVerified) {
      return res.json({ success: true, message: 'Your email is already verified' })
    }

    await issueEmailVerification(user)

    return res.json({
      success: true,
      message: `Sent a new link to ${user.email}`,
    })
  } catch (error) {
    next(error)
  }
}

/** The link a person clicks from the verification email. */
export const verifyEmail = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = verifyEmailSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({ success: false, message: 'Missing token' })
    }

    const user = await User.findOne({
      emailVerificationTokenHash: hashToken(result.data.token),
      emailVerificationExpiresAt: { $gt: new Date() },
    }).select('+emailVerificationTokenHash +emailVerificationExpiresAt')

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'That link is invalid or has expired — ask for a new one from Account.',
      })
    }

    user.emailVerified = true
    user.emailVerificationTokenHash = null
    user.emailVerificationExpiresAt = null
    await user.save()

    return res.json({ success: true, message: 'Email verified' })
  } catch (error) {
    next(error)
  }
}

/**
 * Starts a password reset. Always responds the same way regardless of
 * whether the account exists (account enumeration) — the email itself,
 * sent only when it genuinely does, is where the actual signal lives.
 */
export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = forgotPasswordSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({ success: false, message: 'Invalid request' })
    }

    const { identifier } = result.data
    const user = await User.findOne({
      status: 'ACTIVE',
      $or: [
        { username: identifier },
        { email: identifier.toLowerCase() },
      ],
    })

    if (user) {
      const token = generateToken()
      user.passwordResetTokenHash = hashToken(token)
      user.passwordResetExpiresAt = new Date(
        Date.now() + PASSWORD_RESET_MINUTES * 60 * 1000,
      )
      await user.save()
      try {
        await sendPasswordResetEmail(
          user.email,
          user.displayName || user.username,
          token,
        )
      } catch (error) {
        console.error('[fico/api] Could not send password reset email:', error)
      }
    }

    return res.json({ success: true, message: FORGOT_PASSWORD_MESSAGE })
  } catch (error) {
    next(error)
  }
}

/** The link a person clicks from the password-reset email, plus their new password. */
export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = resetPasswordSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const user = await User.findOne({
      passwordResetTokenHash: hashToken(result.data.token),
      passwordResetExpiresAt: { $gt: new Date() },
    }).select('+passwordResetTokenHash +passwordResetExpiresAt')

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'That link is invalid or has expired — request a new one.',
      })
    }

    user.passwordHash = await hashPassword(result.data.newPassword)
    user.passwordResetTokenHash = null
    user.passwordResetExpiresAt = null
    await user.save()

    // A password reset this way means the old one may have leaked (or was
    // simply forgotten) — every device signs in fresh either way, same as
    // an admin setting a new password on someone else's account.
    await Session.updateMany(
      { userId: user._id },
      { $set: { revokedAt: new Date() } },
    )

    return res.json({
      success: true,
      message: 'Password reset. Sign in with your new password.',
    })
  } catch (error) {
    next(error)
  }
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim() || ''
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null

/** A free username from a Google name/email: letters, digits, underscores only. */
const usernameFromGoogle = async (name: string | undefined, email: string): Promise<string> => {
  const base =
    (name || email.split('@')[0] || 'fico')
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
      .slice(0, 22) || 'fico'
  const padded = base.length < 3 ? `${base}_user` : base
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = attempt === 0 ? padded : `${padded}_${crypto.randomInt(100, 9999)}`
    if (!(await User.exists({ username: candidate }))) return candidate
  }
  return `fico_${crypto.randomBytes(5).toString('hex')}`
}

/**
 * Sign in — or sign up — with Google. The browser hands over Google's ID
 * token; it's verified against Google with this app's client id, then:
 * an account already linked to that Google id signs in; otherwise one with
 * the same (Google-verified) email gets linked and signs in; otherwise a
 * new account is created (its email already verified by Google). Accounts
 * with 2FA on still have to enter their code, exactly like a password
 * sign-in. Disabled entirely until GOOGLE_CLIENT_ID is set.
 */
export const googleAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!googleClient) {
      return res.status(503).json({ success: false, message: "Google sign-in isn't set up on this server yet" })
    }
    const result = googleAuthSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({ success: false, message: 'Invalid Google sign-in request' })
    }
    const { credential, termsAccepted, deviceId } = result.data

    let payload
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID })
      payload = ticket.getPayload()
    } catch {
      return res.status(401).json({ success: false, message: 'Google sign-in failed — please try again' })
    }
    if (!payload?.sub || !payload.email) {
      return res.status(401).json({ success: false, message: 'Google did not share an email address' })
    }
    if (!payload.email_verified) {
      return res.status(401).json({ success: false, message: 'That Google account’s email isn’t verified yet' })
    }

    const email = payload.email.toLowerCase()
    let user = await User.findOne({ googleId: payload.sub })
    if (!user) user = await User.findOne({ email })

    if (user) {
      if (isRestricted(user.restriction)) {
        return res.status(403).json(restrictedResponse(user.restriction!))
      }
      if (user.status !== 'ACTIVE') {
        return res.status(401).json({ success: false, message: 'This account is disabled' })
      }
      let changed = false
      if (!user.googleId) { user.googleId = payload.sub; changed = true }
      if (!user.emailVerified) { user.emailVerified = true; changed = true }
      if (changed) await user.save()
    } else {
      if (termsAccepted !== true) {
        return res.status(400).json({
          success: false,
          code: 'TERMS_REQUIRED',
          message: 'Please agree to the Terms & Conditions and Privacy Policy to create an account',
        })
      }
      user = await User.create({
        username: await usernameFromGoogle(payload.given_name || payload.name, email),
        email,
        // A Google-only account has no password; this random hash can't be
        // guessed. "Forgot password" can set a real one later if wanted.
        passwordHash: await hashPassword(crypto.randomBytes(32).toString('hex')),
        googleId: payload.sub,
        displayName: payload.name?.slice(0, 60) || undefined,
        emailVerified: true,
        status: 'ACTIVE',
        termsAcceptedAt: new Date(),
      })
      await createPersonalSpace(user.id)
      await consumePendingInvitations(user.id, email)
    }

    if (user.totpEnabled) {
      const pendingToken = generateSessionId()
      await TwoFactorChallenge.create({
        userId: user.id,
        tokenHash: hashSessionId(pendingToken),
        deviceId,
        userAgent: userAgentOf(req),
        expiresAt: new Date(Date.now() + TWO_FACTOR_CHALLENGE_MINUTES * 60 * 1000),
      })
      return res.json({
        success: true,
        requiresTwoFactor: true,
        pendingToken,
        message: 'Enter your authenticator code to finish signing in',
      })
    }

    const { expiresAt } = await createSession(user.id, res, deviceId, userAgentOf(req))
    return res.json({
      success: true,
      message: 'Signed in with Google',
      user: toPublicUser(user),
      session: { expiresAt: expiresAt.toISOString() },
    })
  } catch (error) {
    next(error)
  }
}

