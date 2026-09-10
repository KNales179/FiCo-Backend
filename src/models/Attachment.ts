import mongoose, { Document, Schema } from 'mongoose'

export type AttachmentEntityType =
  | 'TRANSACTION'
  | 'SHOPPING_ITEM'
  | 'BILL_PAYMENT'
  | 'ELECTRICITY_RECORD'

export interface IAttachment extends Document {
  spaceId: mongoose.Types.ObjectId
  entityType: AttachmentEntityType
  entityId: mongoose.Types.ObjectId
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
      type: Schema.Types.ObjectId,
      required: true,
    },
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

const Attachment = mongoose.model<IAttachment>(
  'Attachment',
  attachmentSchema,
)

export default Attachment
