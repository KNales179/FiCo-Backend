import mongoose, { Document, Schema } from 'mongoose'

/**
 * A restricted person asking the admin team to reconsider. Sent from the
 * sign-in screen (they can't sign in while restricted), reviewed on the
 * Admin → Appeals page, and the decision is sent back to them.
 *
 * - OPEN: waiting for an admin.
 * - LIFTED: restriction removed.
 * - SHORTENED: restriction kept but ends sooner.
 * - KEPT: restriction stays as it was.
 */
export type AppealStatus = 'OPEN' | 'LIFTED' | 'SHORTENED' | 'KEPT'

export interface IAppeal extends Document {
  userId: mongoose.Types.ObjectId
  message: string
  /** The restriction as it stood when they appealed. */
  restriction: { reason: string; until: Date | null; at: Date }
  status: AppealStatus
  decisionNote?: string | null
  decidedById?: mongoose.Types.ObjectId | null
  decidedAt?: Date | null
  /** For SHORTENED: the new end. */
  newUntil?: Date | null
  createdAt: Date
  updatedAt: Date
}

const appealSchema = new Schema<IAppeal>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    message: { type: String, required: true, trim: true, minlength: 10, maxlength: 2000 },
    restriction: {
      type: new Schema(
        {
          reason: { type: String, required: true },
          until: { type: Date, default: null },
          at: { type: Date, required: true },
        },
        { _id: false },
      ),
      required: true,
    },
    status: { type: String, enum: ['OPEN', 'LIFTED', 'SHORTENED', 'KEPT'], default: 'OPEN', index: true },
    decisionNote: { type: String, default: null, maxlength: 1000 },
    decidedById: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    newUntil: { type: Date, default: null },
  },
  { timestamps: true },
)

appealSchema.index({ status: 1, createdAt: -1 })

const Appeal = mongoose.model<IAppeal>('Appeal', appealSchema)

export default Appeal
