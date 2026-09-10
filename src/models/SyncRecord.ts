import mongoose, { Document, Schema } from 'mongoose'

/**
 * A replicated domain record. The local-first client is the source of truth for
 * shape; the server stores the latest payload per `clientId` and relays it to
 * the space's other devices (Architecture §29, §34). Server-side reads that
 * need synced data (analytics) aggregate over this collection.
 */
export interface ISyncRecord extends Document {
  spaceId: mongoose.Types.ObjectId
  entityType: string
  /** The client-generated id (`crypto.randomUUID()`) — the stable identity. */
  clientId: string
  /** The full client record, as last accepted. */
  payload: Record<string, unknown>
  /** Monotonic version, bumped on every accepted change (conflict detection). */
  version: number
  deletedAt?: Date | null
  updatedAt: Date
  updatedBy: mongoose.Types.ObjectId
  createdAt: Date
}

const syncRecordSchema = new Schema<ISyncRecord>(
  {
    spaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Space',
      required: true,
      index: true,
    },
    entityType: { type: String, required: true },
    clientId: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    version: { type: Number, default: 1 },
    deletedAt: { type: Date, default: null },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true },
)

syncRecordSchema.index(
  { spaceId: 1, entityType: 1, clientId: 1 },
  { unique: true },
)
// The pull query: everything in a space changed since a cursor.
syncRecordSchema.index({ spaceId: 1, updatedAt: 1 })

const SyncRecord = mongoose.model<ISyncRecord>(
  'SyncRecord',
  syncRecordSchema,
)

export default SyncRecord

/**
 * A processed sync-event id, kept briefly so a retried push is idempotent
 * (Architecture §38). TTL-expired after a week.
 */
export interface IProcessedEvent extends Document {
  eventId: string
  spaceId: mongoose.Types.ObjectId
  createdAt: Date
}

const processedEventSchema = new Schema<IProcessedEvent>({
  eventId: { type: String, required: true, unique: true },
  spaceId: { type: Schema.Types.ObjectId, required: true },
  createdAt: { type: Date, default: Date.now },
})
processedEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 7 * 24 * 60 * 60 },
)

export const ProcessedEvent = mongoose.model<IProcessedEvent>(
  'ProcessedEvent',
  processedEventSchema,
)
