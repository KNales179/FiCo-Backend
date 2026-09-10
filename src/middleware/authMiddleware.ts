import { NextFunction, Request, Response } from 'express'
import Session from '../models/Session.js'
import User from '../models/User.js'
import { hashSessionId } from '../utils/session.js'

export interface AuthRequest extends Request {
  user?: {
    id: string
    username: string
    email: string
    displayName: string | null
  }
  sessionId?: string
  session?: {
    expiresAt: string
  }
}

const SESSION_DURATION_DAYS =
  Number(process.env.SESSION_DURATION_DAYS) || 7

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Validates the session cookie, loads the user, and slides the session's
 * expiry forward when it is past the halfway mark — a lightweight refresh so an
 * actively used device is not logged out on a fixed schedule (Architecture §41).
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
      res.clearCookie('fico_session')

      return res.status(401).json({
        success: false,
        message: 'Session expired or invalid',
      })
    }

    const user = await User.findById(session.userId)

    if (!user || user.status !== 'ACTIVE') {
      await Session.updateOne(
        { _id: session._id },
        { $set: { revokedAt: new Date() } },
      )

      res.clearCookie('fico_session')

      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      })
    }

    const now = Date.now()
    const fullWindowMs = SESSION_DURATION_DAYS * DAY_MS
    const remainingMs = session.expiresAt.getTime() - now

    const updates: Record<string, Date> = {}

    // Sliding renewal once the session is more than halfway to expiry.
    if (remainingMs < fullWindowMs / 2) {
      const nextExpiry = new Date(now + fullWindowMs)
      updates.expiresAt = nextExpiry
      session.expiresAt = nextExpiry

      res.cookie('fico_session', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        expires: nextExpiry,
        path: '/',
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
