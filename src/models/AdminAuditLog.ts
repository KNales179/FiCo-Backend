import mongoose, { Document, Schema } from 'mongoose'

/**
 * An admin action taken on someone else's account — password changes, role
 * grants/revocations, forced device sign-outs. These are account-wide (not
 * scoped to one Finance/space the way `ActionLog` is), so they get their
 * own append-only trail rather than being squeezed into that one.
 *
 * Per the project's threat-based-authorization policy, a Level 3/4 action
 * (affecting another user, security-relevant, hard to reverse) should be
 * auditable — including a *failed* attempt, which is itself security-
 * relevant (someone guessing at the acting admin's password, say).
 */
export type AdminAuditAction =
  | 'SET_PASSWORD'
  | 'SET_ROLE'
  | 'REVOKE_SESSION'
  | 'STEP_UP_FAILED'

export interface IAdminAuditLog extends Document {
  /** The admin who performed (or attempted) the action. */
  actorId: mongoose.Types.ObjectId
  action: AdminAuditAction
  /** The account the action targeted, when there is one (not for a bare failed step-up). */
  targetUserId?: mongoose.Types.ObjectId | null
  result: 'SUCCESS' | 'FAILURE'
  /** One line of context — never a secret (no passwords, tokens, codes). */
  detail?: string | null
  createdAt: Date
}

const adminAuditLogSchema = new Schema<IAdminAuditLog>(
  {
    actorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    action: { type: String, required: true },
    targetUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    result: { type: String, required: true },
    detail: { type: String, default: null, maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

adminAuditLogSchema.index({ createdAt: -1 })

/** Retention mirrors `ActionLog` — a rolling window, not a permanent archive. */
const ttlDays = Number(process.env.ADMIN_AUDIT_LOG_TTL_DAYS) || 365
adminAuditLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: ttlDays * 24 * 60 * 60 },
)

const AdminAuditLog = mongoose.model<IAdminAuditLog>(
  'AdminAuditLog',
  adminAuditLogSchema,
)

export default AdminAuditLog
