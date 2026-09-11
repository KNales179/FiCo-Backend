import mongoose, { Document, Schema } from 'mongoose'

export interface ISession extends Document {
  userId: mongoose.Types.ObjectId
  sessionHash: string
  deviceId?: string
  /** Raw User-Agent header at login, for a person to recognize their own
   *  devices ("Chrome on Windows") — not parsed/normalized, just stored. */
  userAgent?: string | null
  expiresAt: Date
  lastUsedAt: Date
  revokedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const sessionSchema = new Schema<ISession>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    sessionHash: {
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

    lastUsedAt: {
      type: Date,
      default: Date.now,
    },

    revokedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
)

// TTL: let MongoDB drop expired sessions automatically.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const Session = mongoose.model<ISession>('Session', sessionSchema)

export default Session
