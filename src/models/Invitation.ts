import crypto from 'crypto'
import mongoose, { Document, Schema } from 'mongoose'

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED'

export interface IInvitation extends Document {
  spaceId: mongoose.Types.ObjectId
  email: string
  token: string
  invitedBy: mongoose.Types.ObjectId
  status: InvitationStatus
  expiresAt: Date
  acceptedBy?: mongoose.Types.ObjectId | null
  createdAt: Date
  updatedAt: Date
}

const invitationSchema = new Schema<IInvitation>(
  {
    spaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Space',
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomBytes(24).toString('hex'),
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'REVOKED'],
      default: 'PENDING',
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    acceptedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true },
)

invitationSchema.index(
  { spaceId: 1, email: 1, status: 1 },
)

const Invitation = mongoose.model<IInvitation>(
  'Invitation',
  invitationSchema,
)

export default Invitation
