import { NextFunction, Response } from 'express'
import mongoose from 'mongoose'
import ActionLog, { IActionLog } from '../models/ActionLog.js'
import { fieldChanges } from '../services/actionLogService.js'
import User from '../models/User.js'
import { SpaceRequest } from '../middleware/spaceAccess.js'

const serialize = (
  log: IActionLog,
  actorName: string | null,
) => ({
  id: String(log._id),
  actorId: String(log.actorId),
  actorName,
  action: log.action,
  entityType: log.entityType,
  entityId: log.entityId,
  summary: log.summary,
  createdAt: log.createdAt,
  changes: changesOf(log),
})

/** "What changed" as a list — for edits that recorded it (older ones didn't). */
const changesOf = (log: IActionLog) => {
  const before = log.oldValue as Record<string, unknown> | undefined
  const after = log.newValue as Record<string, unknown> | undefined
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return []
  // Conflict entries keep whole records; show only the fields that differ.
  const diff = log.action === 'CONFLICT' ? fieldChanges(before, after) : { oldValue: before, newValue: after }
  if (!diff) return []
  return Object.keys(diff.newValue).map((field) => ({
    field,
    from: diff.oldValue[field] ?? null,
    to: diff.newValue[field] ?? null,
  }))
}

/** The Activity tabs, by what kind of thing happened. */
const MEMBER_ACTIONS = ['MEMBER_ADD', 'MEMBER_REMOVE', 'ROLE_CHANGE', 'OWNERSHIP_TRANSFER', 'INVITE']
const GROUPS: Record<string, Record<string, unknown>> = {
  members: { action: { $in: MEMBER_ACTIONS } },
  conflicts: { action: 'CONFLICT' },
  records: { action: { $nin: [...MEMBER_ACTIONS, 'CONFLICT'] } },
}

/** The Records tab's "Show" filter. */
const KINDS: Record<string, string[]> = {
  money: ['transaction', 'account', 'reconciliation'],
  bills: ['bill', 'billPayment', 'electricityRecord'],
  tobuy: ['shoppingList', 'shoppingItem', 'itemProfile', 'priceHistory'],
  planning: ['budgetPlan', 'category'],
}

/**
 * GET /api/spaces/:spaceId/action-logs?limit=&before=&entityId=&group=&kind=
 * The space's activity, newest first — only its owner and admins may read
 * it (see actionLogRoutes). `group` picks a tab (records, members,
 * conflicts); `kind` narrows records (money, bills, tobuy, planning). The
 * log is append-only and has no mutation routes (Architecture §26).
 */
export const listActionLogs = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const limit = Math.min(
      Math.max(Number(req.query.limit) || 50, 1),
      200,
    )

    const filter: Record<string, unknown> = {
      spaceId: req.space!._id,
      // Private records never show in Activity. Older conflict entries could
      // have kept a Private record's values, so leave those out when reading.
      $nor: [{ 'oldValue.visibility': 'PRIVATE' }, { 'newValue.visibility': 'PRIVATE' }],
    }
    if (typeof req.query.entityId === 'string') {
      filter.entityId = req.query.entityId
    }
    const group = typeof req.query.group === 'string' ? GROUPS[req.query.group] : undefined
    if (group) Object.assign(filter, group)
    const kind = typeof req.query.kind === 'string' ? KINDS[req.query.kind] : undefined
    if (kind) filter.entityType = { $in: kind }
    if (
      typeof req.query.before === 'string' &&
      !Number.isNaN(Date.parse(req.query.before))
    ) {
      filter.createdAt = { $lt: new Date(req.query.before) }
    }

    const logs = await ActionLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)

    const hasMore = logs.length > limit
    const page = hasMore ? logs.slice(0, limit) : logs

    const actorIds = [
      ...new Set(page.map((l) => String(l.actorId))),
    ].filter((id) => mongoose.Types.ObjectId.isValid(id))
    const users = await User.find({ _id: { $in: actorIds } })
      .select('username displayName')
      .lean()
    const nameById = new Map(
      users.map((u) => [
        String(u._id),
        u.displayName || u.username,
      ]),
    )

    return res.json({
      success: true,
      logs: page.map((log) =>
        serialize(log, nameById.get(String(log.actorId)) ?? null),
      ),
      nextBefore: hasMore
        ? page[page.length - 1].createdAt.toISOString()
        : null,
    })
  } catch (error) {
    next(error)
  }
}
