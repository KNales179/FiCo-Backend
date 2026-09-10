import mongoose from 'mongoose'
import ActionLog, { ActionType } from '../models/ActionLog.js'

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
