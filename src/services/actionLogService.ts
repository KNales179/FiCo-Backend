import mongoose from 'mongoose'
import ActionLog, { ActionType } from '../models/ActionLog.js'

// Bookkeeping fields nobody needs to see in "what changed".
const NOISE = new Set([
  'id',
  'spaceId',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
  'version',
  'fieldUpdatedAt',
  'syncedAt',
  'deletedAt',
  'visibility',
])

const short = (value: unknown): unknown =>
  typeof value === 'string' && value.length > 120 ? `${value.slice(0, 117)}…` : value

/**
 * Just the fields an edit actually changed, before and after — what the
 * Activity page shows as "Amount ₱120 → ₱150". Null when nothing visible
 * changed. Kept small: at most 12 fields, long text trimmed.
 */
export const fieldChanges = (
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  only?: string[],
): { oldValue: Record<string, unknown>; newValue: Record<string, unknown> } | null => {
  if (!before || !after) return null
  const keys = (only ?? [...new Set([...Object.keys(before), ...Object.keys(after)])]).filter((k) => !NOISE.has(k))
  const oldValue: Record<string, unknown> = {}
  const newValue: Record<string, unknown> = {}
  let n = 0
  for (const key of keys) {
    if (JSON.stringify(before[key] ?? null) === JSON.stringify(after[key] ?? null)) continue
    // Nested objects/lists (item lists, breakdowns) are summarised, not dumped.
    const complex = (v: unknown) => v !== null && typeof v === 'object'
    oldValue[key] = complex(before[key]) ? '(changed)' : short(before[key] ?? null)
    newValue[key] = complex(after[key]) ? '(changed)' : short(after[key] ?? null)
    if (++n >= 12) break
  }
  return n ? { oldValue, newValue } : null
}

/**
 * Append one entry to a space's activity trail (Architecture §26, §40).
 * Append-only: there are no update/delete paths. Never throws into the caller —
 * a logging failure must not break the action it describes.
 */
export const logAction = async (params: {
  spaceId: mongoose.Types.ObjectId | string
  actorId: mongoose.Types.ObjectId | string
  action: ActionType
  entityType: string
  entityId: string
  summary: string
  oldValue?: unknown
  newValue?: unknown
}): Promise<void> => {
  try {
    await ActionLog.create({
      spaceId: params.spaceId,
      actorId: params.actorId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      summary: params.summary.slice(0, 300),
      oldValue: params.oldValue,
      newValue: params.newValue,
    })
  } catch {
    // best effort
  }
}
