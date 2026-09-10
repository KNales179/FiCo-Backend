import mongoose, { Document, Schema } from 'mongoose'

export interface IBillPayment extends Document {
  spaceId: mongoose.Types.ObjectId
  billId: mongoose.Types.ObjectId
  /** Actual amount paid — immutable once recorded (Product Spec §12, §13). */
  amountMinor: number
  paidAt: Date
  /** The occurrence this payment settles: "YYYY-MM" monthly, "YYYY" yearly. */
  periodKey: string
  accountId: mongoose.Types.ObjectId
  transactionId?: mongoose.Types.ObjectId | null
  deletedAt?: Date | null
  createdBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const billPaymentSchema = new Schema<IBillPayment>(
  {
    spaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Space',
      required: true,
      index: true,
    },
    billId: {
      type: Schema.Types.ObjectId,
      ref: 'Bill',
      required: true,
      index: true,
    },
    amountMinor: {
      type: Number,
      required: true,
      validate: {
        validator: (v: number) => Number.isInteger(v) && v > 0,
        message: 'amountMinor must be a positive integer',
      },
    },
    paidAt: { type: Date, required: true },
    periodKey: { type: String, required: true },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
    },
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
    },
    deletedAt: { type: Date, default: null },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true },
)

// One payment per bill per occurrence — the duplicate-payment guard.
billPaymentSchema.index({ billId: 1, periodKey: 1 }, { unique: true })

const BillPayment = mongoose.model<IBillPayment>(
  'BillPayment',
  billPaymentSchema,
)

export default BillPayment
