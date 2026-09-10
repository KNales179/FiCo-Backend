import { NextFunction, Response } from 'express'
import mongoose from 'mongoose'
import ActionLog, { IActionLog } from '../models/ActionLog.js'
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
})

/**
 * GET /api/spaces/:spaceId/action-logs?limit=&before=&entityId=
 * The space's activity, newest first. Any member may read; the log is
 * append-only and has no mutation routes (Architecture §26).
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

    const filter: Record<string, unknown> = { spaceId: req.space!._id }
    if (typeof req.query.entityId === 'string') {
      filter.entityId = req.query.entityId
    }
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
