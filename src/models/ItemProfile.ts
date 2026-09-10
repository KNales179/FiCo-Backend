import mongoose, { Document, Schema } from 'mongoose'

export interface IItemProfile extends Document {
  spaceId: mongoose.Types.ObjectId
  /** Lowercased, whitespace-collapsed name used for matching. */
  normalizedName: string
  /** The name as the user first typed it, for display. */
  displayName: string
  /** Free-text category ("Food", "Transport"). Applied to future purchases only. */
  category?: string | null
  createdAt: Date
  updatedAt: Date
}

const itemProfileSchema = new Schema<IItemProfile>(
  {
    spaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Space',
      required: true,
      index: true,
    },
    normalizedName: { type: String, required: true },
    displayName: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, trim: true, maxlength: 60, default: null },
  },
  { timestamps: true },
)

itemProfileSchema.index({ spaceId: 1, normalizedName: 1 }, { unique: true })

const ItemProfile = mongoose.model<IItemProfile>(
  'ItemProfile',
  itemProfileSchema,
)

export default ItemProfile
