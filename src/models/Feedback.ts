import mongoose, { Document, Schema } from 'mongoose'

export type FeedbackType = 'BUG' | 'SUGGESTION'
export type FeedbackStatus = 'OPEN' | 'RESOLVED'

/** A bug report or suggestion from any signed-in user — account-wide, not
 *  tied to one Finance/space, and visible only to a system admin. */
export interface IFeedback extends Document {
  userId: mongoose.Types.ObjectId
  type: FeedbackType
  message: string
  status: FeedbackStatus
  createdAt: Date
  updatedAt: Date
}

const feedbackSchema = new Schema<IFeedback>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['BUG', 'SUGGESTION'],
      required: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: ['OPEN', 'RESOLVED'],
      default: 'OPEN',
    },
  },
  { timestamps: true },
)

feedbackSchema.index({ createdAt: -1 })
feedbackSchema.index({ status: 1, createdAt: -1 })

const Feedback = mongoose.model<IFeedback>('Feedback', feedbackSchema)

export default Feedback
