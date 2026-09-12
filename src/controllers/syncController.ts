import { NextFunction, Response } from 'express'
import SyncRecord, { ProcessedEvent } from '../models/SyncRecord.js'
import { SpaceRequest } from '../middleware/spaceAccess.js'
import { logAction } from '../services/actionLogService.js'
import type { ActionType } from '../models/ActionLog.js'
import {
  pushSchema,
  validateSyncPayload,
} from '../validation/syncValidation.js'

type PushResultStatus =
  | 'applied'
  | 'conflict-resolved'
  | 'duplicate'
  | 'rejected'
  | 'stale'

interface PushResult {
  eventId: string
  status: PushResultStatus
  version?: number
  message?: string
}

const OPERATION_TO_ACTION: Record<string, ActionType> = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  CHECK: 'CHECK',
  UNCHECK: 'UNCHECK',
  PAY: 'PAY',
  SHARE: 'SHARE',
  UNSHARE: 'UNSHARE',
}

const summarize = (
  entityType: string,
  operation: string,
  payload: Record<string, unknown>,
): string => {
  const name =
    (payload.title as string) ||
    (payload.name as string) ||
    (payload.displayName as string) ||
    entityType
  switch (operation) {
    case 'CREATE':
      return `added ${entityType} "${name}"`
    case 'DELETE':
      return `removed ${entityType} "${name}"`
    case 'CHECK':
      return `checked "${name}"`
    case 'UNCHECK':
      return `unchecked "${name}"`
    case 'PAY':
      return `paid "${name}"`
    default:
      return `updated ${entityType} "${name}"`
  }
}

/**
 * POST /api/spaces/:spaceId/sync/push
 * Applies a batch of local mutations to the space's replicated store.
 * Idempotent per event id; conflicts are resolved last-write-wins by the
 * payload's `updatedAt` and recorded in the action log (Architecture §38–§39).
 */
export const pushSync = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const parsed = pushSchema.safeParse(req.body)
    if (!parsed.success) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid sync batch' })
    }

    const spaceId = req.space!._id
    const userId = req.user!.id
    const results: PushResult[] = []

    for (const event of parsed.data.events) {
      // Idempotency: atomically claim this event id *before* touching any
      // record, using the unique index on `eventId` as the actual guard —
      // a plain "does it exist yet?" check here would leave a race window
      // where two concurrent pushes of the same retried event both pass
      // the check and both apply the mutation before either one's claim
      // lands. `create` either wins the claim or fails on the duplicate
      // key, so exactly one concurrent attempt ever proceeds past this
      // point for a given event id.
      try {
        await ProcessedEvent.create({ eventId: event.id, spaceId })
      } catch {
        results.push({ eventId: event.id, status: 'duplicate' })
        continue
      }

      try {
        const isDelete = event.operation === 'DELETE'
        const validation = validateSyncPayload(
          event.entityType,
          event.payload,
        )

        if (!isDelete && !validation.ok) {
          // A validation failure isn't a durable outcome the way applying,
          // resolving a conflict, or losing to a newer version is — the
          // payload was never actually accepted. Release the claim so a
          // person-initiated retry (after `retryFailed`) genuinely
          // re-validates instead of coming back "duplicate" and getting
          // wrongly marked synced on the client for a mutation that was
          // never actually applied.
          await ProcessedEvent.deleteOne({ eventId: event.id }).catch(
            () => undefined,
          )
          results.push({
            eventId: event.id,
            status: 'rejected',
            message: validation.error,
          })
          continue
        }

        const payload = validation.ok
          ? validation.value
          : { id: event.entityId }

        const existing = await SyncRecord.findOne({
          spaceId,
          entityType: event.entityType,
          clientId: event.entityId,
        })

        let status: PushResultStatus = 'applied'

        if (existing) {
          const incomingUpdatedAt = String(payload.updatedAt ?? '')
          const currentUpdatedAt =
            (existing.payload.updatedAt as string) ??
            existing.updatedAt.toISOString()

          const changedByAnother =
            String(existing.updatedBy) !== userId &&
            existing.version >= (event.baseVersion ?? 0) + 1

          if (
            !isDelete &&
            incomingUpdatedAt &&
            incomingUpdatedAt < currentUpdatedAt
          ) {
            // Our copy is newer — the client's edit was based on an older
            // version and loses under last-write-wins. Keep the history.
            if (changedByAnother) {
              await logAction({
                spaceId,
                actorId: userId,
                action: 'CONFLICT',
                entityType: event.entityType,
                entityId: event.entityId,
                summary: `discarded a conflicting edit to ${event.entityType} (a newer change already won)`,
                oldValue: payload,
                newValue: existing.payload,
              })
            }
            results.push({
              eventId: event.id,
              status: 'stale',
              version: existing.version,
            })
            continue
          }

          if (changedByAnother && !isDelete) {
            status = 'conflict-resolved'
            await logAction({
              spaceId,
              actorId: userId,
              action: 'CONFLICT',
              entityType: event.entityType,
              entityId: event.entityId,
              summary: `resolved a conflicting edit to ${event.entityType} (kept the newer change)`,
              oldValue: existing.payload,
              newValue: payload,
            })
          }

          existing.payload = isDelete
            ? { ...existing.payload, deletedAt: new Date().toISOString() }
            : payload
          existing.version += 1
          existing.updatedBy = userId as unknown as typeof existing.updatedBy
          if (isDelete || payload.deletedAt) {
            existing.deletedAt = new Date()
          }
          await existing.save()
          results.push({
            eventId: event.id,
            status,
            version: existing.version,
          })
        } else {
          try {
            const created = await SyncRecord.create({
              spaceId,
              entityType: event.entityType,
              clientId: event.entityId,
              payload,
              version: event.clientVersion ?? 1,
              updatedBy: userId,
              deletedAt: payload.deletedAt ? new Date() : null,
            })
            results.push({
              eventId: event.id,
              status: 'applied',
              version: created.version,
            })
          } catch {
            // Another device created it first (unique index). Merge onto it.
            const raced = await SyncRecord.findOne({
              spaceId,
              entityType: event.entityType,
              clientId: event.entityId,
            })
            if (raced) {
              raced.payload = payload
              raced.version += 1
              raced.updatedBy = userId as unknown as typeof raced.updatedBy
              await raced.save()
              results.push({
                eventId: event.id,
                status: 'conflict-resolved',
                version: raced.version,
              })
            } else {
              results.push({ eventId: event.id, status: 'rejected' })
            }
          }
        }

        // Activity trail for shared records (Architecture §26).
        const isShared =
          (payload.visibility ?? 'SPACE') !== 'PRIVATE'
        if (isShared && OPERATION_TO_ACTION[event.operation]) {
          await logAction({
            spaceId,
            actorId: userId,
            action: OPERATION_TO_ACTION[event.operation],
            entityType: event.entityType,
            entityId: event.entityId,
            summary: summarize(event.entityType, event.operation, payload),
          })
        }
      } catch (eventError) {
        // Something went wrong applying this one event — release the
        // claim above so a legitimate retry can actually re-attempt it,
        // rather than a failed mutation silently being treated as if it
        // had succeeded.
        await ProcessedEvent.deleteOne({ eventId: event.id }).catch(
          () => undefined,
        )
        throw eventError
      }
    }

    return res.json({ success: true, results })
  } catch (error) {
    next(error)
  }
}

/**
 * GET /api/spaces/:spaceId/sync/pull?since=<ISO>&limit=
 * Records in this space changed after `since`, respecting record visibility.
 */
export const pullSync = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const spaceId = req.space!._id
    const userId = req.user!.id

    const since =
      typeof req.query.since === 'string' &&
      !Number.isNaN(Date.parse(req.query.since))
        ? new Date(req.query.since)
        : new Date(0)

    const limit = Math.min(
      Math.max(Number(req.query.limit) || 500, 1),
      1000,
    )

    // Visibility lives inside the payload for synced records.
    const rows = await SyncRecord.find({
      spaceId,
      updatedAt: { $gt: since },
      $or: [
        { 'payload.visibility': { $ne: 'PRIVATE' } },
        { 'payload.createdBy': userId },
        { 'payload.ownerId': userId },
      ],
    })
      .sort({ updatedAt: 1 })
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    return res.json({
      success: true,
      records: page.map((r) => ({
        entityType: r.entityType,
        clientId: r.clientId,
        payload: r.payload,
        version: r.version,
        deletedAt: r.deletedAt ?? null,
        updatedAt: r.updatedAt,
      })),
      cursor:
        page.length > 0
          ? page[page.length - 1].updatedAt.toISOString()
          : req.query.since ?? new Date(0).toISOString(),
      hasMore,
    })
  } catch (error) {
    next(error)
  }
}
