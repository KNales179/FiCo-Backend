import mongoose, { Document, Schema } from 'mongoose'

export type AttachmentEntityType =
  | 'TRANSACTION'
  | 'SHOPPING_ITEM'
  | 'BILL_PAYMENT'
  | 'ELECTRICITY_RECORD'

export interface IAttachment extends Document {
  spaceId: mongoose.Types.ObjectId
  entityType: AttachmentEntityType
  /** The record's id as the app knows it (a client id, not a Mongo ObjectId). */
  entityId: string
  /** The app's own id for this attachment — makes a retried upload a no-op. */
  clientId?: string | null
  /** Original filename — for display only, never used as a path (Architecture §30). */
  fileName: string
  mimeType: string
  size: number
  /** Cloudinary public_id — the reference we sign delivery URLs against. */
  storageKey: string
  /** Cloudinary resource_type (image / raw / video) for that public_id. */
  resourceType: string
  createdBy: mongoose.Types.ObjectId
  deletedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

const attachmentSchema = new Schema<IAttachment>(
  {
    spaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Space',
      required: true,
      index: true,
    },
    entityType: {
      type: String,
      enum: [
        'TRANSACTION',
        'SHOPPING_ITEM',
        'BILL_PAYMENT',
        'ELECTRICITY_RECORD',
      ],
      required: true,
    },
    entityId: {
      type: String,
      required: true,
      maxlength: 120,
    },
    clientId: { type: String, default: null, maxlength: 120 },
    fileName: { type: String, required: true, maxlength: 260 },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    storageKey: { type: String, required: true },
    resourceType: { type: String, default: 'image' },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

attachmentSchema.index({ entityType: 1, entityId: 1 })
attachmentSchema.index(
  { spaceId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } },
)

const Attachment = mongoose.model<IAttachment>(
  'Attachment',
  attachmentSchema,
)

export default Attachment
