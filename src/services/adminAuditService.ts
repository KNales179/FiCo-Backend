import mongoose from 'mongoose'
import AdminAuditLog, { AdminAuditAction } from '../models/AdminAuditLog.js'

/**
 * Append one entry to the admin-action audit trail. Append-only, like
 * `logAction` — and, same as there, a logging failure must never break the
 * action it describes.
 */
export const logAdminAudit = async (params: {
  actorId: mongoose.Types.ObjectId | string
  action: AdminAuditAction
  targetUserId?: mongoose.Types.ObjectId | string | null
  result: 'SUCCESS' | 'FAILURE'
  detail?: string | null
}): Promise<void> => {
  try {
    await AdminAuditLog.create({
      actorId: params.actorId,
      action: params.action,
      targetUserId: params.targetUserId ?? null,
      result: params.result,
      detail: params.detail?.slice(0, 300) ?? null,
    })
  } catch {
    // best effort
  }
}
