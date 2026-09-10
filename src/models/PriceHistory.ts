import mongoose, { Document, Schema } from 'mongoose'

export interface IPriceHistory extends Document {
  spaceId: mongoose.Types.ObjectId
  itemProfileId: mongoose.Types.ObjectId
  amountMinor: number
  purchasedAt: Date
  transactionId?: mongoose.Types.ObjectId | null
  createdAt: Date
  updatedAt: Date
}

const priceHistorySchema = new Schema<IPriceHistory>(
  {
    spaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Space',
      required: true,
      index: true,
    },
    itemProfileId: {
      type: Schema.Types.ObjectId,
      ref: 'ItemProfile',
      required: true,
      index: true,
    },
    amountMinor: {
      type: Number,
      required: true,
      validate: {
        validator: (v: number) => Number.isInteger(v) && v >= 0,
        message: 'amountMinor must be a non-negative integer',
      },
    },
    purchasedAt: { type: Date, required: true },
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
    },
  },
  { timestamps: true },
)

const PriceHistory = mongoose.model<IPriceHistory>(
  'PriceHistory',
  priceHistorySchema,
)

export default PriceHistory
