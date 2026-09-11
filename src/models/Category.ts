import mongoose, { Document, Schema } from 'mongoose'

export type CategoryKind = 'EXPENSE' | 'INCOME'

export interface ICategory extends Document {
  spaceId: mongoose.Types.ObjectId
  name: string
  normalizedName: string
  kind: CategoryKind
  archived: boolean
  /** Picking this category switches entry to an itemized list (§ batch buying). */
  tracksItems: boolean
  createdBy: mongoose.Types.ObjectId
  deletedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

const categorySchema = new Schema<ICategory>(
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
      maxlength: 40,
    },
    normalizedName: { type: String, required: true },
    kind: {
      type: String,
      enum: ['EXPENSE', 'INCOME'],
      default: 'EXPENSE',
    },
    archived: { type: Boolean, default: false },
    tracksItems: { type: Boolean, default: false },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

categorySchema.index(
  { spaceId: 1, kind: 1, normalizedName: 1 },
  { unique: true },
)

const Category = mongoose.model<ICategory>('Category', categorySchema)

export default Category

/** Seeded when a space is created. */
export const DEFAULT_CATEGORIES: Array<{
  name: string
  kind: CategoryKind
  tracksItems?: boolean
}> = [
  { name: 'Food', kind: 'EXPENSE' },
  { name: 'Groceries', kind: 'EXPENSE', tracksItems: true },
  { name: 'Transportation', kind: 'EXPENSE' },
  { name: 'Bills', kind: 'EXPENSE' },
  { name: 'Health', kind: 'EXPENSE' },
  { name: 'Shopping', kind: 'EXPENSE', tracksItems: true },
  { name: 'Entertainment', kind: 'EXPENSE' },
  { name: 'Education', kind: 'EXPENSE' },
  { name: 'Other', kind: 'EXPENSE' },
  { name: 'Salary', kind: 'INCOME' },
  { name: 'Other income', kind: 'INCOME' },
]
