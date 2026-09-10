import mongoose, { Document, Schema } from 'mongoose'

export interface ISession extends Document {
  userId: mongoose.Types.ObjectId
  sessionHash: string
  deviceId?: string
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
