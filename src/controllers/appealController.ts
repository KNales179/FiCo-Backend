import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import mongoose from 'mongoose'
import { z } from 'zod'
import Appeal from '../models/Appeal.js'
import User from '../models/User.js'
import { AuthRequest, isRestricted, restrictedResponse } from '../middleware/authMiddleware.js'
import { logAdminAudit } from '../services/adminAuditService.js'
import { notifyUser } from '../services/notificationService.js'
import { sendPushToUserIfEnabled } from '../utils/push.js'

const APPEAL_TOKEN_MINUTES = 60

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex')

const appealDto = (a: InstanceType<typeof Appeal>) => ({
  id: a.id,
  status: a.status,
  message: a.message,
  decisionNote: a.decisionNote ?? null,
  newUntil: a.newUntil?.toISOString() ?? null,
  createdAt: a.createdAt.toISOString(),
  decidedAt: a.decidedAt?.toISOString() ?? null,
})

/** The latest appeal against the restriction they have now (not an older one). */
const currentAppeal = async (user: InstanceType<typeof User>) => {
  if (!user.restriction) return null
  return Appeal.findOne({ userId: user._id, 'restriction.at': user.restriction.at }).sort({ createdAt: -1 })
}

/**
 * What a restricted person gets back from a sign-in with the *right*
 * password: the restriction (reason, until), a short-lived token that lets
 * them send an appeal from the sign-in screen, and — if they already
 * appealed — where that stands.
 */
export const restrictedLoginResponse = async (user: InstanceType<typeof User>) => {
  const token = crypto.randomBytes(24).toString('hex')
  user.appealTokenHash = hash(token)
  user.appealTokenExpiresAt = new Date(Date.now() + APPEAL_TOKEN_MINUTES * 60_000)
  await user.save()
  const existing = await currentAppeal(user)
  const base = restrictedResponse(user.restriction!)
  return {
    ...base,
    notice: { ...base.notice, appeal: { token, existing: existing ? appealDto(existing) : null } },
  }
}

const createSchema = z.object({
  token: z.string().min(20).max(200),
  message: z
    .string()
    .trim()
    .min(10, 'Tell the team a little more — at least a sentence')
    .max(2000),
})

/** Public (no session — they can't sign in): send an appeal with the token from a restricted sign-in. */
export const createAppeal = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = createSchema.safeParse(req.body)
    if (!result.success) {
      const first = Object.values(result.error.flatten().fieldErrors).flat().find(Boolean)
      return res.status(400).json({ success: false, message: first ?? 'Invalid appeal' })
    }
    const user = await User.findOne({
      appealTokenHash: hash(result.data.token),
      appealTokenExpiresAt: { $gt: new Date() },
    })
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'That appeal link has expired — sign in again with your password to appeal.',
      })
    }
    if (!isRestricted(user.restriction)) {
      return res.status(400).json({ success: false, message: 'Your account isn’t restricted any more — you can sign in.' })
    }
    // One appeal per restriction.
    const existing = await currentAppeal(user)
    if (existing) {
      return res.status(409).json({
        success: false,
        message:
          existing.status === 'OPEN'
            ? 'You already have an appeal waiting for review.'
            : 'This restriction was already appealed and reviewed.',
      })
    }

    const appeal = await Appeal.create({
      userId: user._id,
      message: result.data.message,
      restriction: { reason: user.restriction!.reason, until: user.restriction!.until, at: user.restriction!.at },
    })

    // Let the admins know.
    const admins = await User.find({ role: 'ADMIN', status: 'ACTIVE' }).select('_id')
    await Promise.all(
      admins.map((a) =>
        sendPushToUserIfEnabled(a._id, 'feedbackReports', {
          title: `New appeal from ${user.username}`,
          body: result.data.message.slice(0, 140),
          url: `/admin/appeals/${appeal.id}`,
        }).catch(() => undefined),
      ),
    )

    return res.status(201).json({ success: true, message: 'Appeal sent', appeal: appealDto(appeal) })
  } catch (error) {
    next(error)
  }
}

// ───────────────────────────── Admin ─────────────────────────────

const userBrief = (u: unknown) => {
  const user = u as { _id?: mongoose.Types.ObjectId; username?: string; displayName?: string; email?: string; avatarUrl?: string } | null
  return user
    ? { id: String(user._id), username: user.username ?? '', displayName: user.displayName ?? null, email: user.email ?? '', avatarUrl: user.avatarUrl ?? null }
    : null
}

export const listAppeals = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [appeals, open] = await Promise.all([
      Appeal.find().sort({ status: 1, createdAt: -1 }).limit(200).populate('userId', 'username displayName email avatarUrl'),
      Appeal.countDocuments({ status: 'OPEN' }),
    ])
    // OPEN first, then newest.
    appeals.sort((a, b) => (a.status === 'OPEN' ? 0 : 1) - (b.status === 'OPEN' ? 0 : 1) || b.createdAt.getTime() - a.createdAt.getTime())
    return res.json({
      success: true,
      open,
      appeals: appeals.map((a) => ({
        ...appealDto(a),
        user: userBrief(a.userId),
        restriction: { reason: a.restriction.reason, until: a.restriction.until?.toISOString() ?? null, at: a.restriction.at.toISOString() },
      })),
    })
  } catch (error) {
    next(error)
  }
}

export const getAppeal = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!mongoose.isValidObjectId(req.params.appealId)) return res.status(404).json({ success: false, message: 'Appeal not found' })
    const appeal = await Appeal.findById(req.params.appealId)
      .populate('userId', 'username displayName email avatarUrl restriction')
      .populate('decidedById', 'username displayName')
    if (!appeal) return res.status(404).json({ success: false, message: 'Appeal not found' })
    const target = appeal.userId as unknown as InstanceType<typeof User> | null
    const decider = appeal.decidedById as unknown as { username?: string; displayName?: string } | null
    const previous = target
      ? await Appeal.countDocuments({ userId: target._id, _id: { $ne: appeal._id } })
      : 0
    return res.json({
      success: true,
      appeal: {
        ...appealDto(appeal),
        user: userBrief(target),
        restriction: {
          reason: appeal.restriction.reason,
          until: appeal.restriction.until?.toISOString() ?? null,
          at: appeal.restriction.at.toISOString(),
        },
        /** The restriction as it is right now (may have changed or ended since). */
        currentRestriction:
          target && isRestricted(target.restriction)
            ? { reason: target.restriction!.reason, until: target.restriction!.until?.toISOString() ?? null }
            : null,
        decidedBy: decider ? decider.displayName || decider.username || 'admin' : null,
        previousAppeals: previous,
      },
    })
  } catch (error) {
    next(error)
  }
}

const decideSchema = z
  .object({
    decision: z.enum(['LIFT', 'SHORTEN', 'KEEP']),
    note: z.string().trim().min(3, 'Write a short note — they’ll read it').max(1000),
    durationHours: z.number().int().min(1).max(24 * 366).optional(),
  })
  .refine((d) => d.decision !== 'SHORTEN' || d.durationHours, {
    message: 'Pick the new length',
    path: ['durationHours'],
  })

/** Lift / shorten / keep — the person is told the outcome and the note. */
export const decideAppeal = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = decideSchema.safeParse(req.body)
    if (!result.success) {
      const first = Object.values(result.error.flatten().fieldErrors).flat().find(Boolean)
      return res.status(400).json({ success: false, message: first ?? 'Invalid decision' })
    }
    if (!mongoose.isValidObjectId(req.params.appealId)) return res.status(404).json({ success: false, message: 'Appeal not found' })
    const appeal = await Appeal.findById(req.params.appealId)
    if (!appeal) return res.status(404).json({ success: false, message: 'Appeal not found' })
    if (appeal.status !== 'OPEN') return res.status(400).json({ success: false, message: 'That appeal was already decided' })
    const user = await User.findById(appeal.userId)
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })

    const { decision, note, durationHours } = result.data
    const stillRestricted = isRestricted(user.restriction)
    let title: string
    let body: string

    if (decision === 'LIFT') {
      user.restriction = null
      await user.save()
      appeal.status = 'LIFTED'
      title = 'Your appeal was accepted'
      body = `Your restriction has been lifted — welcome back to Fico.\n\n${note}`
    } else if (decision === 'SHORTEN') {
      const until = new Date(Date.now() + durationHours! * 3600_000)
      if (stillRestricted) {
        user.restriction!.until = until
        user.markModified('restriction')
        await user.save()
      }
      appeal.status = 'SHORTENED'
      appeal.newUntil = until
      title = 'Your appeal was reviewed — restriction shortened'
      body = `Your restriction now ends ${until.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })}.\n\n${note}`
    } else {
      appeal.status = 'KEPT'
      title = 'Your appeal was reviewed'
      body = `After looking at it again, the restriction stays as it was.\n\n${note}`
    }

    appeal.decisionNote = note
    appeal.decidedById = new mongoose.Types.ObjectId(req.user!.id)
    appeal.decidedAt = new Date()
    await appeal.save()

    // They'll see this on the sign-in screen next time they try (the
    // restricted response includes the appeal), in Notifications once
    // they're back in, and as a push if they had notifications on.
    await notifyUser({
      userId: user._id,
      kind: 'ADMIN_ACTION',
      title,
      body,
      senderName: 'Fico Admin Team',
      senderId: req.user!.id,
      popup: true,
      link: '/notifications',
    })
    await logAdminAudit({
      actorId: req.user!.id,
      action: 'APPEAL_DECISION',
      targetUserId: user.id,
      result: 'SUCCESS',
      detail: `${appeal.status} — ${note}`,
    })

    return res.json({ success: true, message: `Decision sent to ${user.username}`, appeal: appealDto(appeal) })
  } catch (error) {
    next(error)
  }
}
