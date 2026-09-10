import mongoose, { Document, Schema } from 'mongoose'

export type MembershipRole = 'OWNER' | 'EDITOR' | 'VIEWER'
export type MembershipStatus = 'ACTIVE' | 'INVITED' | 'REVOKED'

/** Higher number = more capable. Used for `requireSpaceMember(minRole)`. */
export const ROLE_RANK: Record<MembershipRole, number> = {
  VIEWER: 1,
  EDITOR: 2,
  OWNER: 3,
}

export interface IMembership extends Document {
  spaceId: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  role: MembershipRole
  status: MembershipStatus
  createdAt: Date
  updatedAt: Date
}

const membershipSchema = new Schema<IMembership>(
  {
    spaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Space',
      required: true,
      index: true,
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    role: {
      type: String,
      enum: ['OWNER', 'EDITOR', 'VIEWER'],
      required: true,
    },

    status: {
      type: String,
      enum: ['ACTIVE', 'INVITED', 'REVOKED'],
      default: 'ACTIVE',
    },
  },
  {
    timestamps: true,
  },
)

// One membership per user per space.
membershipSchema.index({ spaceId: 1, userId: 1 }, { unique: true })

const Membership = mongoose.model<IMembership>(
  'Membership',
  membershipSchema,
)

export default Membership
