import mongoose, { Document, Schema } from 'mongoose'

export type TransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER'

export type TransactionSourceType =
  | 'MANUAL'
  | 'SHOPPING_ITEM'
  | 'SHOPPING_LIST'
  | 'BILL_PAYMENT'

export interface ITransaction extends Document {
  spaceId: mongoose.Types.ObjectId
  type: TransactionType
  amountMinor: number
  currency: string
  title: string
  details?: string
  categoryId?: mongoose.Types.ObjectId | null
  /** Category name captured at creation time — never rewritten (Product Spec §10). */
  categoryName?: string | null
  accountId: mongoose.Types.ObjectId
  destinationAccountId?: mongoose.Types.ObjectId | null
  occurredAt: Date
  sourceType: TransactionSourceType
  sourceId?: string | null
  createdBy: mongoose.Types.ObjectId
  deletedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

const transactionSchema = new Schema<ITransaction>(
  {
    spaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Space',
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ['INCOME', 'EXPENSE', 'TRANSFER'],
      required: true,
    },

    // Integer minor units, always > 0. Direction comes from `type`.
    amountMinor: {
      type: Number,
      required: true,
      validate: {
        validator: (value: number) =>
          Number.isInteger(value) && value > 0,
        message: 'amountMinor must be a positive integer',
      },
    },

    currency: {
      type: String,
      default: 'PHP',
      uppercase: true,
      minlength: 3,
      maxlength: 3,
    },

    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 120,
    },

    details: {
      type: String,
      trim: true,
      maxlength: 2000,
    },

    categoryId: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
    },

    categoryName: {
      type: String,
      trim: true,
      maxlength: 60,
      default: null,
    },

    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      index: true,
    },

    // Only set for TRANSFER — the account money moves into.
    destinationAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },

    occurredAt: {
      type: Date,
      required: true,
      index: true,
    },

    sourceType: {
      type: String,
      enum: ['MANUAL', 'SHOPPING_ITEM', 'SHOPPING_LIST', 'BILL_PAYMENT'],
      default: 'MANUAL',
    },

    sourceId: {
      type: String,
      default: null,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
)

transactionSchema.index({ spaceId: 1, occurredAt: -1 })

const Transaction = mongoose.model<ITransaction>(
  'Transaction',
  transactionSchema,
)

export default Transaction
