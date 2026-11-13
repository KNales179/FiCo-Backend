import mongoose from 'mongoose'
import { NextFunction, Response } from 'express'
import SyncRecord, { ProcessedEvent } from '../models/SyncRecord.js'
import Membership from '../models/Membership.js'
import { SpaceRequest } from '../middleware/spaceAccess.js'
import { logAction } from '../services/actionLogService.js'
import type { ActionType } from '../models/ActionLog.js'
import { sendPushToUserIfEnabled } from '../utils/push.js'
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
  /** For `stale` (or a partly-kept edit): the copy that won, so the device can take it. */
  record?: Record<string, unknown>
  /** Fields of this edit that lost to a newer change from someone else. */
  lostFields?: string[]
}

// Never merged from an edit: identity and bookkeeping.
const FIXED_FIELDS = new Set(['id', 'spaceId', 'createdAt', 'createdBy', 'syncStatus', 'version'])

/**
 * Apply only the fields an edit changed onto the server's copy. A field
 * goes through unless someone else changed that same field more recently.
 */
const mergeFields = (
  current: Record<string, unknown>,
  times: Record<string, string>,
  incoming: Record<string, unknown>,
  changed: string[],
): { merged: Record<string, unknown>; times: Record<string, string>; applied: string[]; lost: string[] } => {
  const at = String(incoming.updatedAt ?? '')
  const merged = { ...current }
  const nextTimes = { ...times }
  const applied: string[] = []
  const lost: string[] = []
  for (const field of changed) {
    if (FIXED_FIELDS.has(field) || field === 'updatedAt') continue
    const last = nextTimes[field] ?? ''
    if (!last || at >= last) {
      merged[field] = incoming[field]
      nextTimes[field] = at
      applied.push(field)
    } else {
      lost.push(field)
    }
  }
  const currentAt = String(current.updatedAt ?? '')
  merged.updatedAt = at > currentAt ? at : currentAt
  return { merged, times: nextTimes, applied, lost }
}

const allFieldTimes = (payload: Record<string, unknown>): Record<string, string> => {
  const at = String(payload.updatedAt ?? '')
  const times: Record<string, string> = {}
  for (const key of Object.keys(payload)) if (!FIXED_FIELDS.has(key)) times[key] = at
  return times
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

/** Every other *active* member of the space — never the person who made the change. */
const otherActiveMembers = async (
  spaceId: mongoose.Types.ObjectId | string,
  actorUserId: string,
): Promise<string[]> => {
  const members = await Membership.find({ spaceId, status: 'ACTIVE' })
  return members
    .map((m) => String(m.userId))
    .filter((id) => id !== actorUserId)
}

/**
 * Push notifications for the rest of a shared Finance (Roadmap feedback):
 * someone else creating a shopping list or a bill, or paying one, is worth
 * knowing about even away from the app. Best effort — a stalled/misconfigured
 * push setup must never affect whether the sync push itself succeeds.
 */
const notifyOtherMembers = async (
  spaceId: mongoose.Types.ObjectId | string,
  userId: string,
  entityType: string,
  operation: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  try {
    if (entityType === 'shoppingList' && operation === 'CREATE') {
      const title = (payload.title as string) || 'A shopping list'
      const others = await otherActiveMembers(spaceId, userId)
      await Promise.all(
        others.map((id) =>
          sendPushToUserIfEnabled(id, 'shoppingUpdates', {
            title: 'New to-buy list',
            body: `"${title}" was just added`,
            tag: `shopping-list-${payload.id}`,
            url: '/shopping',
          }),
        ),
      )
      return
    }

    if (entityType === 'bill' && operation === 'CREATE') {
      const name = (payload.name as string) || 'A bill'
      const others = await otherActiveMembers(spaceId, userId)
      await Promise.all(
        others.map((id) =>
          sendPushToUserIfEnabled(id, 'billUpdates', {
            title: 'New bill added',
            body: name,
            tag: `bill-${payload.id}`,
            url: '/bills',
          }),
        ),
      )
      return
    }

    if (entityType === 'billPayment' && operation === 'PAY') {
      const bill = await SyncRecord.findOne({
        spaceId,
        entityType: 'bill',
        clientId: payload.billId as string,
      })
      const name = (bill?.payload.name as string) || 'A bill'
      const others = await otherActiveMembers(spaceId, userId)
      await Promise.all(
        others.map((id) =>
          sendPushToUserIfEnabled(id, 'billUpdates', {
            title: 'Bill paid',
            body: name,
            tag: `bill-payment-${payload.id}`,
            url: '/bills',
          }),
        ),
      )
    }
  } catch (error) {
    console.error('[fico/api] Could not send change notification:', error)
  }
}

/**
 * A transaction touching an account *someone else* added (Roadmap
 * feedback: "user1 made a transfer from user1's account to user2's
 * account, user2 will be notified") — the account's own `createdBy` marks
 * whose it is for this purpose. Only fires when the actor differs from
 * the account's owner; never for the owner's own activity on their account.
 */
const notifyAccountOwnerOfTransaction = async (
  spaceId: mongoose.Types.ObjectId | string,
  userId: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  try {
    const accountIds = [payload.accountId, payload.destinationAccountId].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    )
    if (accountIds.length === 0) return

    const accounts = await SyncRecord.find({
      spaceId,
      entityType: 'account',
      clientId: { $in: accountIds },
    })

    const notified = new Set<string>()
    await Promise.all(
      accounts.map(async (record) => {
        const ownerId = record.payload.createdBy as string | undefined
        if (!ownerId || ownerId === userId || notified.has(ownerId)) return
        notified.add(ownerId)
        const name = (payload.title as string) || 'A transaction'
        await sendPushToUserIfEnabled(ownerId, 'accountActivity', {
          title: 'Activity on your account',
          body: name,
          tag: `transaction-${payload.id}`,
          url: '/',
        })
      }),
    )
  } catch (error) {
    console.error('[fico/api] Could not notify account owner:', error)
  }
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

          // The device told us exactly which fields this edit changed:
          // merge just those, so edits to different fields both survive.
          if (!isDelete && event.changedFields?.length) {
            const { merged, times, applied, lost } = mergeFields(
              existing.payload,
              existing.fieldUpdatedAt ?? {},
              payload,
              event.changedFields,
            )
            const winner = {
              ...merged,
              deletedAt: existing.deletedAt ? existing.deletedAt.toISOString() : (merged.deletedAt ?? null),
            }
            if (applied.length === 0) {
              results.push({ eventId: event.id, status: 'stale', version: existing.version, record: winner, lostFields: lost })
              continue
            }
            existing.payload = merged
            existing.fieldUpdatedAt = times
            existing.markModified('payload')
            existing.markModified('fieldUpdatedAt')
            existing.version += 1
            existing.updatedBy = userId as unknown as typeof existing.updatedBy
            if (merged.deletedAt) existing.deletedAt = existing.deletedAt ?? new Date()
            await existing.save()
            results.push({
              eventId: event.id,
              status: lost.length ? 'conflict-resolved' : 'applied',
              version: existing.version,
              ...(lost.length ? { record: winner, lostFields: lost } : {}),
            })
            if (lost.length) {
              await logAction({
                spaceId,
                actorId: userId,
                action: 'CONFLICT',
                entityType: event.entityType,
                entityId: event.entityId,
                summary: `kept a newer change to ${lost.join(', ')} on ${event.entityType}`,
                oldValue: payload,
                newValue: merged,
              })
            }
            if ((merged.visibility ?? 'SPACE') !== 'PRIVATE' && OPERATION_TO_ACTION[event.operation]) {
              await logAction({
                spaceId,
                actorId: userId,
                action: OPERATION_TO_ACTION[event.operation],
                entityType: event.entityType,
                entityId: event.entityId,
                summary: summarize(event.entityType, event.operation, merged),
              })
            }
            await notifyOtherMembers(spaceId, userId, event.entityType, event.operation, payload)
            continue
          }

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
              record: {
                ...existing.payload,
                deletedAt: existing.deletedAt ? existing.deletedAt.toISOString() : (existing.payload.deletedAt ?? null),
              },
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
          if (!isDelete) {
            existing.fieldUpdatedAt = allFieldTimes(payload)
            existing.markModified('fieldUpdatedAt')
          }
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
        } else if (isDelete) {
          // Deleting something the server never received (its create
          // failed or never arrived). Keep only a tombstone — never a
          // half-empty record — so other devices that do have it drop it.
          const now = new Date()
          await SyncRecord.create({
            spaceId,
            entityType: event.entityType,
            clientId: event.entityId,
            payload: { id: event.entityId, deletedAt: now.toISOString() },
            version: event.clientVersion ?? 1,
            updatedBy: userId,
            deletedAt: now,
          }).catch(() => undefined)
          results.push({ eventId: event.id, status: 'applied' })
          continue
        } else {
          try {
            const created = await SyncRecord.create({
              spaceId,
              entityType: event.entityType,
              clientId: event.entityId,
              payload,
              fieldUpdatedAt: allFieldTimes(payload),
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

        await notifyOtherMembers(
          spaceId,
          userId,
          event.entityType,
          event.operation,
          payload,
        )
        if (event.entityType === 'transaction' && event.operation === 'CREATE') {
          await notifyAccountOwnerOfTransaction(spaceId, userId, payload)
        }
      } catch (eventError) {
        // Something went wrong applying this one event — release the
        // claim above so a legitimate retry can actually re-attempt it,
        // rather than a failed mutation silently being treated as if it
        // had succeeded. And keep going: one bad change used to fail the
        // whole batch, so every change queued after it never synced.
        await ProcessedEvent.deleteOne({ eventId: event.id }).catch(
          () => undefined,
        )
        console.error('[fico/api] sync event failed:', event.entityType, event.operation, eventError)
        results.push({
          eventId: event.id,
          status: 'rejected',
          message: 'The server couldn’t save this change. Tap “Try again”, or discard it.',
        })
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
