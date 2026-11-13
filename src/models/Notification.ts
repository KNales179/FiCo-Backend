import mongoose, { Document, Schema } from 'mongoose'

/**
 * Something Fico wants one person to know — shown on their Notifications
 * page (and, for `popup` ones, as a pop-up the next time they open the
 * app). Account-wide, not tied to a Finance.
 *
 * - FEEDBACK_DONE: a report/suggestion they sent was marked done.
 * - ADMIN_NOTICE: a message an admin sent them, signed by that admin or
 *   anonymously as "the Fico Admin Team".
 * - ADMIN_ACTION: an admin did something to their account (role change,
 *   restriction lifted, password reset…), with the reason given.
 */
export type NotificationKind = 'FEEDBACK_DONE' | 'ADMIN_NOTICE' | 'ADMIN_ACTION' | 'FINANCE_ROLE' | 'BADGE'

export interface INotification extends Document {
  userId: mongoose.Types.ObjectId
  kind: NotificationKind
  title: string
  body: string
  /** An in-app path to open when tapped, e.g. "/updates". */
  link?: string | null
  /** Who it's from, as shown — "Fico Admin Team" when sent anonymously. */
  senderName?: string | null
  /** The admin who sent it; kept even when shown anonymously (for the audit trail). */
  senderId?: mongoose.Types.ObjectId | null
  /** Show as a pop-up on next open, not only in the list. */
  popup: boolean
  readAt?: Date | null
  createdAt: Date
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['FEEDBACK_DONE', 'ADMIN_NOTICE', 'ADMIN_ACTION', 'FINANCE_ROLE', 'BADGE'], required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    link: { type: String, default: null, maxlength: 200 },
    senderName: { type: String, default: null, maxlength: 80 },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    popup: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

notificationSchema.index({ userId: 1, createdAt: -1 })

/** Kept for a rolling window, like the activity log. */
const ttlDays = Number(process.env.NOTIFICATION_TTL_DAYS) || 180
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: ttlDays * 24 * 60 * 60 })

const Notification = mongoose.model<INotification>('Notification', notificationSchema)

export default Notification
