import mongoose, { Document, Schema } from 'mongoose'

/**
 * A one-time sign-up code. Fico is invite-only for now: creating an account
 * (with a password or with Google) needs an unused code made by a Fico
 * admin. Using one gives the new account the Beta tester badge. A code
 * works once and expires an hour after it's made.
 */
export interface IInviteCode extends Document {
  /** As shown and shared, e.g. "FICO-7KQ2-M9XA". */
  code: string
  /** The same code with only its letters and digits — what lookups match on. */
  key: string
  /** Who it's for, or any note the admin wants ("Ate Liza", "Facebook giveaway"). */
  note?: string | null
  createdBy: mongoose.Types.ObjectId
  usedBy?: mongoose.Types.ObjectId | null
  usedAt?: Date | null
  revokedAt?: Date | null
  /** Unused codes stop working after this (one hour after they're made). */
  expiresAt: Date
  createdAt: Date
}

const inviteCodeSchema = new Schema<IInviteCode>(
  {
    code: { type: String, required: true },
    key: { type: String, required: true, unique: true },
    note: { type: String, default: null, maxlength: 80 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    usedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    usedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

export default mongoose.model<IInviteCode>('InviteCode', inviteCodeSchema)
