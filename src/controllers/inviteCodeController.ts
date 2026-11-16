import { Response, NextFunction } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import InviteCode from '../models/InviteCode.js'
import User from '../models/User.js'
import { AuthRequest } from '../middleware/authMiddleware.js'
import { logAdminAudit } from '../services/adminAuditService.js'
import { newInviteCode } from '../services/inviteCodeService.js'

type Person = { id: string; username: string } | null

const serialize = (
  c: {
    _id: unknown
    code: string
    note?: string | null
    createdAt: Date
    usedAt?: Date | null
    revokedAt?: Date | null
    expiresAt?: Date | null
  },
  createdBy: Person,
  usedBy: Person,
) => ({
  id: String(c._id),
  code: c.code,
  note: c.note ?? null,
  createdAt: c.createdAt,
  createdBy,
  usedBy,
  usedAt: c.usedAt ?? null,
  revokedAt: c.revokedAt ?? null,
  expiresAt: c.expiresAt ?? null,
  status: c.revokedAt
    ? 'REVOKED'
    : usedBy || c.usedAt
      ? 'USED'
      : c.expiresAt && c.expiresAt.getTime() <= Date.now()
        ? 'EXPIRED'
        : 'UNUSED',
})

/** GET /api/admin/invite-codes — every code, newest first, with who made and used it. */
export const listInviteCodes = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const codes = await InviteCode.find().sort({ createdAt: -1 }).limit(500).lean()
    const ids = [...new Set(codes.flatMap((c) => [c.createdBy, c.usedBy]).filter(Boolean).map(String))]
    const users = await User.find({ _id: { $in: ids } }).select('username').lean()
    const name = new Map(users.map((u) => [String(u._id), u.username]))
    const person = (id: unknown): Person => (id ? { id: String(id), username: name.get(String(id)) ?? 'deleted account' } : null)
    return res.json({
      success: true,
      codes: codes.map((c) => serialize(c, person(c.createdBy), person(c.usedBy))),
    })
  } catch (error) {
    next(error)
  }
}

/** POST /api/admin/invite-codes { count?, note? } — make 1–20 new one-time codes. */
export const createInviteCodes = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = z
      .object({
        count: z.number().int().min(1).max(20).default(1),
        note: z.string().trim().max(80).optional(),
      })
      .safeParse(req.body ?? {})
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Make between 1 and 20 codes, with a note up to 80 characters' })
    }
    const { count, note } = parsed.data
    const made = []
    for (let i = 0; i < count; i++) made.push(await newInviteCode(req.user!.id, note))

    await logAdminAudit({
      actorId: req.user!.id,
      action: 'CREATE_INVITE_CODE',
      result: 'SUCCESS',
      // Never the codes themselves — the audit log isn't where secrets go.
      detail: `made ${count} invite code${count === 1 ? '' : 's'}${note ? ` · ${note.slice(0, 60)}` : ''}`,
    })
    const me = { id: req.user!.id, username: req.user!.username }
    return res.status(201).json({
      success: true,
      message: count === 1 ? 'Invite code made' : `${count} invite codes made`,
      codes: made.map((c) => serialize(c, me, null)),
    })
  } catch (error) {
    next(error)
  }
}

/** DELETE /api/admin/invite-codes/:codeId — cancel a code nobody has used yet. */
export const revokeInviteCode = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.codeId)
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, message: 'Code not found' })
    }
    const code = await InviteCode.findOneAndUpdate(
      { _id: id, usedBy: null, revokedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { revokedAt: new Date() } },
      { new: true },
    )
    if (!code) {
      return res.status(409).json({ success: false, message: 'That code was already used, cancelled, or has expired' })
    }
    await logAdminAudit({
      actorId: req.user!.id,
      action: 'REVOKE_INVITE_CODE',
      result: 'SUCCESS',
      detail: `cancelled an invite code${code.note ? ` · ${code.note.slice(0, 60)}` : ''}`,
    })
    return res.json({ success: true, message: 'Code cancelled — it can’t be used now' })
  } catch (error) {
    next(error)
  }
}
