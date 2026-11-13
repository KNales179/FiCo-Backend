import mongoose, { Document, Schema } from 'mongoose'

/**
 * Roles in a Finance:
 * - OWNER  — everything, plus managing members (invite, remove, change
 *            roles), transferring ownership and deleting the Finance.
 * - ADMIN  — edits everything, and sees the Activity (who changed what).
 * - MEMBER — adds and edits records.
 * - VIEWER — sees everything, changes nothing.
 */
export type MembershipRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'
export type MembershipStatus = 'ACTIVE' | 'INVITED' | 'REVOKED'

/** Higher number = more capable. Used for `requireSpaceMember(minRole)`. */
export const ROLE_RANK: Record<MembershipRole, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
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
      enum: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
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
