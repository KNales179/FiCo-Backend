import mongoose, { Document, Schema } from 'mongoose'

/**
 * One row per bill occurrence a reminder has already gone out for — the
 * bill-reminder job's dedupe key, so a bill sitting in the "due soon" window
 * across many scheduler ticks only ever triggers one push per occurrence.
 * A payment (or the due date otherwise changing) means a new
 * `dueDateNotified`, so the next occurrence gets its own fresh reminder.
 */
export interface IBillNotificationLog extends Document {
  billId: string
  dueDateNotified: string
  notifiedAt: Date
}

const billNotificationLogSchema = new Schema<IBillNotificationLog>({
  billId: {
    type: String,
    required: true,
  },
  dueDateNotified: {
    type: String,
    required: true,
  },
  notifiedAt: {
    type: Date,
    default: Date.now,
  },
})

billNotificationLogSchema.index(
  { billId: 1, dueDateNotified: 1 },
  { unique: true },
)

const BillNotificationLog = mongoose.model<IBillNotificationLog>(
  'BillNotificationLog',
  billNotificationLogSchema,
)

export default BillNotificationLog
