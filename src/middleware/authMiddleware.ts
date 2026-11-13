import { NextFunction, Request, Response } from 'express'
import Session from '../models/Session.js'
import User from '../models/User.js'
import { hashSessionId, sessionCookieOptions } from '../utils/session.js'

export interface AuthRequest extends Request {
  user?: {
    id: string
    username: string
    email: string
    displayName: string | null
    role: 'ADMIN' | 'USER'
    totpEnabled: boolean
    emailVerified: boolean
    avatarUrl: string | null
    notificationPreferences: {
      billReminders: boolean
      shoppingUpdates: boolean
      billUpdates: boolean
      accountActivity: boolean
      feedbackReports: boolean
    }
  }
  sessionId?: string
  session?: {
    expiresAt: string
  }
}

/** What each admin sign-out reason means, in words. */
export const noticeMessage = (code: string): string =>
  ({
    ADMIN_SIGN_OUT: 'You have been signed out by the Fico Admin Team',
    ACCOUNT_RESTRICTED: 'Your account has been restricted on Fico',
    ACCOUNT_DELETED: 'Your Fico account has been deleted by the Fico Admin Team',
    ADMIN_PASSWORD_RESET: 'An admin changed your password, so you were signed out',
    ADMIN_2FA_RESET: 'An admin turned off your two-step sign-in, so you were signed out',
  })[code] ?? 'You have been signed out'

export const isRestricted = (r: { until?: Date | null } | null | undefined): boolean =>
  Boolean(r && (!r.until || r.until.getTime() > Date.now()))

export const restrictedResponse = (r: { reason: string; until?: Date | null; at: Date }) => ({
  success: false,
  code: 'ACCOUNT_RESTRICTED',
  message: noticeMessage('ACCOUNT_RESTRICTED'),
  notice: {
    code: 'ACCOUNT_RESTRICTED',
    reason: r.reason,
    until: r.until?.toISOString() ?? null,
    at: r.at.toISOString(),
  },
})

const SESSION_DURATION_DAYS =
  // 30 days without contacting the server: generous enough for someone
  // using Fico offline for weeks (out in the province, no data) without
  // having to sign in again — and if it still runs out, their offline
  // changes are kept on the device and sync after they sign back in.
  Number(process.env.SESSION_DURATION_DAYS) || 30

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Validates the session cookie, loads the user, and rolls the session's
 * expiry forward on use, so an actively used device is never logged out on
 * a fixed schedule — only after a full idle window (Architecture §41).
 */
export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const sessionId = req.cookies.fico_session

    if (!sessionId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      })
    }

    const sessionHash = hashSessionId(sessionId)

    const session = await Session.findOne({
      sessionHash,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    })

    if (!session) {
      res.clearCookie('fico_session', sessionCookieOptions())

      // Ended by an admin? Say so (and why) — the app shows it as a pop-up.
      const ended = await Session.findOne({ sessionHash, revokedNotice: { $ne: null } }).select('revokedNotice')
      if (ended?.revokedNotice) {
        const n = ended.revokedNotice
        return res.status(401).json({
          success: false,
          code: n.code,
          message: noticeMessage(n.code),
          notice: { code: n.code, reason: n.reason, until: n.until?.toISOString() ?? null, at: n.at.toISOString() },
        })
      }

      return res.status(401).json({
        success: false,
        message: 'Session expired or invalid',
      })
    }

    const user = await User.findById(session.userId)

    if (user && isRestricted(user.restriction)) {
      await Session.updateOne({ _id: session._id }, { $set: { revokedAt: new Date() } })
      res.clearCookie('fico_session', sessionCookieOptions())
      return res.status(403).json(restrictedResponse(user.restriction!))
    }

    if (!user || user.status !== 'ACTIVE') {
      await Session.updateOne(
        { _id: session._id },
        { $set: { revokedAt: new Date() } },
      )

      res.clearCookie('fico_session', sessionCookieOptions())

      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      })
    }

    const now = Date.now()
    const fullWindowMs = SESSION_DURATION_DAYS * DAY_MS
    const remainingMs = session.expiresAt.getTime() - now

    const updates: Record<string, Date> = {}

    // Rolling expiry: any use pushes the expiry back to a full window from
    // now, so a session only ends after SESSION_DURATION_DAYS of *not*
    // using Fico. Written at most once an hour to keep DB writes down.
    if (remainingMs < fullWindowMs - 60 * 60 * 1000) {
      const nextExpiry = new Date(now + fullWindowMs)
      updates.expiresAt = nextExpiry
      session.expiresAt = nextExpiry

      res.cookie('fico_session', sessionId, {
        ...sessionCookieOptions(),
        expires: nextExpiry,
      })
    }

    // Throttle lastUsedAt writes to at most once per hour.
    if (now - session.lastUsedAt.getTime() > 60 * 60 * 1000) {
      updates.lastUsedAt = new Date(now)
    }

    if (Object.keys(updates).length > 0) {
      await Session.updateOne({ _id: session._id }, { $set: updates })
    }

    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName ?? null,
      role: user.role,
      totpEnabled: user.totpEnabled,
      emailVerified: user.emailVerified,
      avatarUrl: user.avatarUrl ?? null,
      notificationPreferences: user.notificationPreferences,
    }

    req.sessionId = sessionId
    req.session = {
      expiresAt: session.expiresAt.toISOString(),
    }

    next()
  } catch (error) {
    next(error)
  }
}

/** Must follow `authenticate`. Gates the admin routes — managing other users'
 *  accounts, not to be confused with a Finance/Space's own owner role. */
export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required',
    })
  }
  next()
}
