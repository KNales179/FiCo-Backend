import { Response, NextFunction } from 'express'
import mongoose from 'mongoose'
import User, { displayBadges } from '../models/User.js'
import Session from '../models/Session.js'
import Membership from '../models/Membership.js'
import Space from '../models/Space.js'
import Feedback from '../models/Feedback.js'
import AdminAuditLog from '../models/AdminAuditLog.js'
import { verifyPassword } from '../utils/password.js'
import { z } from 'zod'
import { AuthRequest } from '../middleware/authMiddleware.js'
import { logAdminAudit } from '../services/adminAuditService.js'
import { notifyUser, signOutEverywhere } from '../services/notificationService.js'
import {
  adminDeleteUserSchema,
  adminNoticeSchema,
  adminRestrictSchema,
  adminSignOutSchema,
  adminUnrestrictSchema,
} from '../validation/adminValidation.js'

const firstError = (fieldErrors: Record<string, string[] | undefined>) =>
  Object.values(fieldErrors).flat().find(Boolean) ?? 'Invalid request'

const adminName = (req: AuthRequest) => req.user?.displayName || req.user?.username || 'An admin'

/** Same step-up as the other admin actions: the acting admin's own password. */
const stepUp = async (req: AuthRequest, password: string, what: string): Promise<boolean> => {
  const admin = await User.findById(req.user?.id)
  const ok = admin ? await verifyPassword(password, admin.passwordHash) : false
  if (!ok) {
    await logAdminAudit({
      actorId: req.user!.id,
      action: 'STEP_UP_FAILED',
      targetUserId: String(req.params.userId),
      result: 'FAILURE',
      detail: `${what}: wrong confirmation password`,
    })
  }
  return ok
}

/** Loads the target, refusing self-targeting for the account-ending actions. */
const loadTarget = async (req: AuthRequest, res: Response, opts: { notSelf?: boolean; notAdmin?: boolean } = {}) => {
  const target = await User.findById(req.params.userId)
  if (!target) {
    res.status(404).json({ success: false, message: 'User not found' })
    return null
  }
  if (opts.notSelf && target.id === req.user?.id) {
    res.status(400).json({ success: false, message: "You can't do that to your own account" })
    return null
  }
  if (opts.notAdmin && target.role === 'ADMIN') {
    res.status(400).json({ success: false, message: 'They’re an admin — remove their admin role first' })
    return null
  }
  return target
}

const restrictionActive = (r: { until: Date | null } | null | undefined) =>
  Boolean(r && (!r.until || r.until.getTime() > Date.now()))

const formatUntil = (until: Date | null) =>
  until
    ? until.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })
    : null

/** Everything the admin's "user profile" page shows. */
export const getUserProfile = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const target = await User.findById(req.params.userId)
    if (!target) return res.status(404).json({ success: false, message: 'User not found' })

    const [sessions, finances, ownedFinances, feedbackOpen, feedbackTotal, audit] = await Promise.all([
      Session.find({ userId: target.id, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastUsedAt: -1 }),
      Membership.countDocuments({ userId: target.id, status: 'ACTIVE' }),
      Space.countDocuments({ ownerId: target.id, deletedAt: null }),
      Feedback.countDocuments({ userId: target.id, status: 'OPEN' }),
      Feedback.countDocuments({ userId: target.id }),
      AdminAuditLog.find({ targetUserId: target.id }).sort({ createdAt: -1 }).limit(20).populate('actorId', 'username displayName'),
    ])
    const lastSeen = await Session.findOne({ userId: target.id }).sort({ lastUsedAt: -1 }).select('lastUsedAt')

    const restriction = restrictionActive(target.restriction) ? target.restriction : null

    const memberships = await Membership.find({ userId: target.id, status: 'ACTIVE' }).lean()
    const spaces = await Space.find({ _id: { $in: memberships.map((m) => m.spaceId) }, deletedAt: null, type: 'FAMILY' })
      .select('name')
      .lean()
    const spaceName = new Map(spaces.map((s) => [String(s._id), s.name]))
    const sharedRoles = memberships
      .filter((m) => spaceName.has(String(m.spaceId)))
      .map((m) => ({ spaceId: String(m.spaceId), name: spaceName.get(String(m.spaceId))!, role: m.role }))

    return res.json({
      success: true,
      user: {
        id: target.id,
        username: target.username,
        email: target.email,
        displayName: target.displayName ?? null,
        avatarUrl: target.avatarUrl ?? null,
        status: target.status,
        role: target.role,
        totpEnabled: target.totpEnabled,
        emailVerified: target.emailVerified,
        createdAt: target.createdAt.toISOString(),
        lastActiveAt: lastSeen?.lastUsedAt?.toISOString() ?? null,
        isSelf: target.id === req.user?.id,
        restriction: restriction
          ? { reason: restriction.reason, until: restriction.until?.toISOString() ?? null, at: restriction.at.toISOString() }
          : null,
        deletedByAdmin: target.deletedByAdmin
          ? { reason: target.deletedByAdmin.reason, at: target.deletedByAdmin.at.toISOString() }
          : null,
        stats: { finances, ownedFinances, feedbackOpen, feedbackTotal },
        badges: displayBadges(target),
        /** The shared Finances they're in, and their role in each. */
        financeRoles: sharedRoles,
      },
      sessions: sessions.map((s) => ({
        id: s.id,
        deviceId: s.deviceId ?? null,
        userAgent: s.userAgent ?? null,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
      })),
      audit: audit.map((a) => {
        const actor = a.actorId as unknown as { username?: string; displayName?: string } | null
        return {
          id: a.id,
          action: a.action,
          result: a.result,
          detail: a.detail ?? null,
          actor: actor?.displayName || actor?.username || 'admin',
          createdAt: a.createdAt.toISOString(),
        }
      }),
    })
  } catch (error) {
    next(error)
  }
}

/** A message to one user — pops up next time they open Fico, and stays on their Notifications page. */
export const sendNotice = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = adminNoticeSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({ success: false, message: firstError(result.error.flatten().fieldErrors) })
    }
    const target = await loadTarget(req, res)
    if (!target) return

    const { title, message, anonymous } = result.data
    const senderName = anonymous ? 'Fico Admin Team' : adminName(req)
    await notifyUser({
      userId: target.id,
      kind: 'ADMIN_NOTICE',
      title: title || (anonymous ? 'A message from the Fico Admin Team' : `A message from ${senderName}`),
      body: message,
      senderName,
      senderId: req.user!.id,
      popup: true,
      link: '/notifications',
    })
    await logAdminAudit({
      actorId: req.user!.id,
      action: 'SEND_NOTICE',
      targetUserId: target.id,
      result: 'SUCCESS',
      detail: `${anonymous ? 'anonymous' : 'signed'}: ${title || message}`,
    })
    return res.json({ success: true, message: `Notice sent to ${target.username}` })
  } catch (error) {
    next(error)
  }
}

/** Sign out of every device; they're told why on the sign-in screen. */
export const signOutUser = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = adminSignOutSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({ success: false, message: firstError(result.error.flatten().fieldErrors) })
    }
    const target = await loadTarget(req, res, { notSelf: true })
    if (!target) return

    const count = await signOutEverywhere(target.id, { code: 'ADMIN_SIGN_OUT', reason: result.data.reason })
    await logAdminAudit({
      actorId: req.user!.id,
      action: 'SIGN_OUT_ALL',
      targetUserId: target.id,
      result: 'SUCCESS',
      detail: `${count} device(s)${result.data.reason ? ` — ${result.data.reason}` : ''}`,
    })
    return res.json({
      success: true,
      message: count ? `${target.username} was signed out of ${count} device${count === 1 ? '' : 's'}` : `${target.username} had no signed-in devices`,
    })
  } catch (error) {
    next(error)
  }
}

/** Block sign-in for a while (or until lifted); every device is signed out with the reason. */
export const restrictUser = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = adminRestrictSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({ success: false, message: firstError(result.error.flatten().fieldErrors) })
    }
    if (!(await stepUp(req, result.data.confirmPassword, 'restrictUser'))) {
      return res.status(401).json({ success: false, message: "That's not your current password" })
    }
    const target = await loadTarget(req, res, { notSelf: true, notAdmin: true })
    if (!target) return

    const until = result.data.durationHours ? new Date(Date.now() + result.data.durationHours * 3600_000) : null
    target.restriction = { reason: result.data.reason, until, byId: new mongoose.Types.ObjectId(req.user!.id), at: new Date() }
    await target.save()
    await signOutEverywhere(target.id, { code: 'ACCOUNT_RESTRICTED', reason: result.data.reason, until })

    await logAdminAudit({
      actorId: req.user!.id,
      action: 'RESTRICT',
      targetUserId: target.id,
      result: 'SUCCESS',
      detail: `${until ? `until ${until.toISOString()}` : 'until lifted'} — ${result.data.reason}`,
    })
    return res.json({
      success: true,
      message: `${target.username} is restricted ${until ? `until ${formatUntil(until)}` : 'until you lift it'}`,
    })
  } catch (error) {
    next(error)
  }
}

export const unrestrictUser = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = adminUnrestrictSchema.safeParse(req.body ?? {})
    if (!result.success) {
      return res.status(400).json({ success: false, message: firstError(result.error.flatten().fieldErrors) })
    }
    const target = await loadTarget(req, res)
    if (!target) return
    if (!restrictionActive(target.restriction)) {
      return res.status(400).json({ success: false, message: `${target.username} isn't restricted` })
    }
    target.restriction = null
    await target.save()

    await notifyUser({
      userId: target.id,
      kind: 'ADMIN_ACTION',
      title: 'Welcome back — your restriction was lifted',
      body: result.data.note || 'You can use Fico normally again. Thanks for your patience.',
      senderName: 'Fico Admin Team',
      senderId: req.user!.id,
      popup: true,
    })
    await logAdminAudit({
      actorId: req.user!.id,
      action: 'UNRESTRICT',
      targetUserId: target.id,
      result: 'SUCCESS',
      detail: result.data.note ?? null,
    })
    return res.json({ success: true, message: `${target.username} can sign in again` })
  } catch (error) {
    next(error)
  }
}

/**
 * Deletes an account the same way "Delete my account" does (disabled, its
 * memberships revoked, the Finances it owns closed) — and the person is told
 * why on their next request from any device.
 */
export const deleteUser = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = adminDeleteUserSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({ success: false, message: firstError(result.error.flatten().fieldErrors) })
    }
    if (!(await stepUp(req, result.data.confirmPassword, 'deleteUser'))) {
      return res.status(401).json({ success: false, message: "That's not your current password" })
    }
    const target = await loadTarget(req, res, { notSelf: true, notAdmin: true })
    if (!target) return
    if (target.status !== 'ACTIVE') {
      return res.status(400).json({ success: false, message: 'That account is already deleted' })
    }

    await signOutEverywhere(target.id, { code: 'ACCOUNT_DELETED', reason: result.data.reason })
    await Membership.updateMany({ userId: target._id, status: 'ACTIVE' }, { $set: { status: 'REVOKED' } })
    await Space.updateMany({ ownerId: target._id, deletedAt: null }, { $set: { deletedAt: new Date() } })
    target.status = 'DISABLED'
    target.deletedByAdmin = { reason: result.data.reason, byId: new mongoose.Types.ObjectId(req.user!.id), at: new Date() }
    await target.save()

    await logAdminAudit({
      actorId: req.user!.id,
      action: 'DELETE_USER',
      targetUserId: target.id,
      result: 'SUCCESS',
      detail: `${target.username} — ${result.data.reason}`,
    })
    return res.json({ success: true, message: `${target.username}'s account was deleted` })
  } catch (error) {
    next(error)
  }
}

const BADGE_LABEL: Record<string, string> = { FICO_OWNER: 'Fico Owner', BETA_TESTER: 'Beta tester' }

/**
 * POST /api/admin/users/:userId/badges { badge, on } — give or take away a
 * badge. Beta tester: any admin. Fico Owner: only someone who already has
 * it (or, while nobody does yet, any admin — so the first one can be given).
 * "Fico Admin" isn't granted here: it comes with the admin role.
 */
export const setUserBadge = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = z.object({ badge: z.enum(['FICO_OWNER', 'BETA_TESTER']), on: z.boolean() }).safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Pick a badge' })
    const { badge, on } = parsed.data

    if (badge === 'FICO_OWNER') {
      const me = await User.findById(req.user!.id).select('badges')
      const anyOwner = await User.exists({ badges: 'FICO_OWNER' })
      if (anyOwner && !me?.badges?.includes('FICO_OWNER')) {
        return res.status(403).json({ success: false, message: 'Only a Fico Owner can give or remove the Fico Owner badge' })
      }
    }

    const target = await loadTarget(req, res)
    if (!target) return
    const has = target.badges.includes(badge)
    if (has === on) return res.json({ success: true, message: 'No change', badges: displayBadges(target) })

    target.badges = on ? [...target.badges, badge] : target.badges.filter((b) => b !== badge)
    await target.save()

    if (on) {
      await notifyUser({
        userId: target.id,
        kind: 'BADGE',
        title: `You’ve got a new badge: ${BADGE_LABEL[badge]}`,
        body:
          badge === 'BETA_TESTER'
            ? 'Thank you for helping test Fico! Your Beta tester badge now shows on your profile.'
            : 'Your Fico Owner badge now shows on your profile.',
        senderName: 'Fico Admin Team',
        senderId: req.user!.id,
        popup: true,
        link: '/account',
      })
    }
    await logAdminAudit({
      actorId: req.user!.id,
      action: 'SET_BADGE',
      targetUserId: target.id,
      result: 'SUCCESS',
      detail: `${on ? 'gave' : 'removed'} ${BADGE_LABEL[badge]}`,
    })
    return res.json({
      success: true,
      message: `${on ? 'Gave' : 'Removed'} ${BADGE_LABEL[badge]} ${on ? 'to' : 'from'} ${target.username}`,
      badges: displayBadges(target),
    })
  } catch (error) {
    next(error)
  }
}
