import mongoose, { Document, Schema } from 'mongoose'

export type ReconciliationStatus = 'OPEN' | 'RESOLVED'

export interface IReconciliation extends Document {
  spaceId: mongoose.Types.ObjectId
  accountId: mongoose.Types.ObjectId
  /** Derived account balance at the moment of the check (Architecture §33). */
  expectedMinor: number
  /** What the user actually counted. */
  actualMinor: number
  /** actual − expected. Positive = surplus, negative = short. */
  differenceMinor: number
  note?: string | null
  status: ReconciliationStatus
  resolvedNote?: string | null
  resolvedAt?: Date | null
  createdBy: mongoose.Types.ObjectId
  deletedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

const reconciliationSchema = new Schema<IReconciliation>(
  {
    spaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Space',
      required: true,
      index: true,
    },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      index: true,
    },
    expectedMinor: { type: Number, required: true },
    actualMinor: { type: Number, required: true },
    differenceMinor: { type: Number, required: true },
    note: { type: String, trim: true, maxlength: 500, default: null },
    status: {
      type: String,
      enum: ['OPEN', 'RESOLVED'],
      default: 'OPEN',
    },
    resolvedNote: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    resolvedAt: { type: Date, default: null },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

const Reconciliation = mongoose.model<IReconciliation>(
  'Reconciliation',
  reconciliationSchema,
)

export default Reconciliation
