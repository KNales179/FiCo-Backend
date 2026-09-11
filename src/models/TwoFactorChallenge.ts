import mongoose, { Document, Schema } from 'mongoose'

/**
 * The gap between "password checked out" and "session issued" for a login
 * that needs a second factor. `tokenHash` (not the raw token) is what's
 * stored, same reasoning as a session id — a DB leak alone can't be
 * replayed. Single-use (deleted on success) and short-lived (TTL-indexed),
 * so a stale one can't be reused or left lying around.
 */
export interface ITwoFactorChallenge extends Document {
  userId: mongoose.Types.ObjectId
  tokenHash: string
  deviceId?: string
  userAgent?: string | null
  expiresAt: Date
  createdAt: Date
}

const twoFactorChallengeSchema = new Schema<ITwoFactorChallenge>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  tokenHash: {
    type: String,
    required: true,
    unique: true,
  },
  deviceId: {
    type: String,
    default: null,
  },
  userAgent: {
    type: String,
    default: null,
    maxlength: 300,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
})

twoFactorChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const TwoFactorChallenge = mongoose.model<ITwoFactorChallenge>(
  'TwoFactorChallenge',
  twoFactorChallengeSchema,
)

export default TwoFactorChallenge
