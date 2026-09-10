import mongoose, { Document, Schema } from 'mongoose'

export type ShoppingListStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED'

export interface IShoppingList extends Document {
  spaceId: mongoose.Types.ObjectId
  title: string
  status: ShoppingListStatus
  /** Optional cash the shopper set aside for this trip (minor units). */
  plannedBudgetMinor?: number | null
  plannedAt?: Date | null
  completedAt?: Date | null
  createdBy: mongoose.Types.ObjectId
  deletedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

const shoppingListSchema = new Schema<IShoppingList>(
  {
    spaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Space',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 120,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'COMPLETED', 'CANCELLED'],
      default: 'ACTIVE',
    },
    plannedBudgetMinor: {
      type: Number,
      default: null,
      validate: {
        validator: (v: number | null) => v === null || Number.isInteger(v),
        message: 'plannedBudgetMinor must be an integer',
      },
    },
    plannedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

shoppingListSchema.index({ spaceId: 1, status: 1 })

const ShoppingList = mongoose.model<IShoppingList>(
  'ShoppingList',
  shoppingListSchema,
)

export default ShoppingList
