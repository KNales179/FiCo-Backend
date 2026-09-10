import mongoose, { Document, Schema } from 'mongoose'

export type BillRecurrence = 'MONTHLY' | 'YEARLY'
export type BillType = 'FIXED' | 'VARIABLE'

export interface IBill extends Document {
  spaceId: mongoose.Types.ObjectId
  name: string
  recurrence: BillRecurrence
  billType: BillType
  /** Expected amount for a FIXED bill; a hint for a VARIABLE one. Minor units. */
  expectedAmountMinor?: number | null
  nextDueDate: Date
  categoryName?: string | null
  paymentAccountId?: mongoose.Types.ObjectId | null
  active: boolean
  /** Show the optional kWh / charge-breakdown fields when paying (Product Spec §16). */
  tracksElectricity: boolean
  deletedAt?: Date | null
  createdBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const billSchema = new Schema<IBill>(
  {
    spaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Space',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 80,
    },
    recurrence: {
      type: String,
      enum: ['MONTHLY', 'YEARLY'],
      required: true,
    },
    billType: {
      type: String,
      enum: ['FIXED', 'VARIABLE'],
      required: true,
    },
    expectedAmountMinor: {
      type: Number,
      default: null,
      validate: {
        validator: (v: number | null) =>
          v === null || (Number.isInteger(v) && v >= 0),
        message: 'expectedAmountMinor must be a non-negative integer',
      },
    },
    nextDueDate: { type: Date, required: true, index: true },
    categoryName: { type: String, trim: true, maxlength: 60, default: null },
    paymentAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },
    active: { type: Boolean, default: true },
    tracksElectricity: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true },
)

billSchema.index({ spaceId: 1, active: 1, nextDueDate: 1 })

const Bill = mongoose.model<IBill>('Bill', billSchema)

export default Bill
