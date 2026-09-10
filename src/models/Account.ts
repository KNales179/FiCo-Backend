import mongoose, { Document, Schema } from 'mongoose'

export type AccountType =
  | 'CASH'
  | 'BANK'
  | 'EWALLET'
  | 'SAVINGS'
  | 'OTHER'

export type AccountStatus = 'ACTIVE' | 'ARCHIVED'

export interface IAccount extends Document {
  spaceId: mongoose.Types.ObjectId
  name: string
  type: AccountType
  currency: string
  openingBalanceMinor: number
  status: AccountStatus
  isDefault: boolean
  createdBy: mongoose.Types.ObjectId
  deletedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

const accountSchema = new Schema<IAccount>(
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
      maxlength: 60,
    },

    type: {
      type: String,
      enum: ['CASH', 'BANK', 'EWALLET', 'SAVINGS', 'OTHER'],
      required: true,
    },

    currency: {
      type: String,
      default: 'PHP',
      uppercase: true,
      minlength: 3,
      maxlength: 3,
    },

    // Integer minor units (centavos). May be negative. Architecture Rule 14.
    openingBalanceMinor: {
      type: Number,
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: 'openingBalanceMinor must be an integer',
      },
    },

    status: {
      type: String,
      enum: ['ACTIVE', 'ARCHIVED'],
      default: 'ACTIVE',
    },

    // The pre-selected payment source for Quick Add. At most one per space.
    isDefault: {
      type: Boolean,
      default: false,
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

const Account = mongoose.model<IAccount>('Account', accountSchema)

export default Account
