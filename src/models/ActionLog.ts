import mongoose, { Document, Schema } from 'mongoose'

export type ActionType =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'CHECK'
  | 'UNCHECK'
  | 'PAY'
  | 'PURCHASE'
  | 'COMPLETE'
  | 'SHARE'
  | 'UNSHARE'
  | 'MEMBER_ADD'
  | 'MEMBER_REMOVE'
  | 'ROLE_CHANGE'
  | 'INVITE'
  | 'CONFLICT'

export interface IActionLog extends Document {
  spaceId: mongoose.Types.ObjectId
  actorId: mongoose.Types.ObjectId
  action: ActionType
  entityType: string
  entityId: string
  /** Human-readable one-liner, e.g. `checked "Rice"`. */
  summary: string
  oldValue?: unknown
  newValue?: unknown
  createdAt: Date
}

const actionLogSchema = new Schema<IActionLog>(
  {
    spaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Space',
      required: true,
      index: true,
    },
    actorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    summary: { type: String, required: true, maxlength: 300 },
    oldValue: { type: Schema.Types.Mixed, default: undefined },
    newValue: { type: Schema.Types.Mixed, default: undefined },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

actionLogSchema.index({ spaceId: 1, createdAt: -1 })
actionLogSchema.index({ spaceId: 1, entityType: 1, entityId: 1 })

const ActionLog = mongoose.model<IActionLog>('ActionLog', actionLogSchema)

export default ActionLog
