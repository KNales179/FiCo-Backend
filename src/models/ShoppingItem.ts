import mongoose, { Document, Schema } from 'mongoose'

export interface IShoppingItem extends Document {
  spaceId: mongoose.Types.ObjectId
  shoppingListId: mongoose.Types.ObjectId
  itemProfileId?: mongoose.Types.ObjectId | null
  name: string
  plannedPriceMinor?: number | null
  actualPriceMinor?: number | null
  quantity: number
  checked: boolean
  purchased: boolean
  /** Added during the trip rather than planned at home (Product Spec §21). */
  addedDuringTrip: boolean
  /** Expense transaction generated for this item, once purchased (Phase 9). */
  transactionId?: mongoose.Types.ObjectId | null
  createdBy: mongoose.Types.ObjectId
  deletedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

const shoppingItemSchema = new Schema<IShoppingItem>(
  {
    spaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Space',
      required: true,
      index: true,
    },
    shoppingListId: {
      type: Schema.Types.ObjectId,
      ref: 'ShoppingList',
      required: true,
      index: true,
    },
    itemProfileId: {
      type: Schema.Types.ObjectId,
      ref: 'ItemProfile',
      default: null,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 120,
    },
    plannedPriceMinor: {
      type: Number,
      default: null,
      validate: {
        validator: (v: number | null) =>
          v === null || (Number.isInteger(v) && v >= 0),
        message: 'plannedPriceMinor must be a non-negative integer',
      },
    },
    actualPriceMinor: {
      type: Number,
      default: null,
      validate: {
        validator: (v: number | null) =>
          v === null || (Number.isInteger(v) && v >= 0),
        message: 'actualPriceMinor must be a non-negative integer',
      },
    },
    quantity: { type: Number, default: 1, min: 1 },
    checked: { type: Boolean, default: false },
    purchased: { type: Boolean, default: false },
    addedDuringTrip: { type: Boolean, default: false },
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

const ShoppingItem = mongoose.model<IShoppingItem>(
  'ShoppingItem',
  shoppingItemSchema,
)

export default ShoppingItem
