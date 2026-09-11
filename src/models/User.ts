import mongoose, { Document, Schema } from 'mongoose'

export type UserRole = 'ADMIN' | 'USER'

export interface IUser extends Document {
  username: string
  email: string
  passwordHash: string
  displayName?: string
  status: 'ACTIVE' | 'DISABLED'
  /** System-wide role — separate from a Finance's own OWNER/MEMBER (Membership).
   *  Only an ADMIN can manage other users' accounts. */
  role: UserRole
  /** Base32 TOTP secret. Set as soon as setup starts, but not enforced at
   *  login until totpEnabled is confirmed true — never null while a setup
   *  is in progress, so a half-finished setup can be resumed or overwritten. */
  totpSecret?: string | null
  totpEnabled: boolean
  /** Argon2 hashes of unused one-time backup codes — never the plaintext. */
  totpBackupCodeHashes: string[]
  createdAt: Date
  updatedAt: Date
}

const userSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    passwordHash: {
      type: String,
      required: true,
    },

    displayName: {
      type: String,
      trim: true,
      maxlength: 60,
      default: null,
    },

    status: {
      type: String,
      enum: ['ACTIVE', 'DISABLED'],
      default: 'ACTIVE',
    },

    role: {
      type: String,
      enum: ['ADMIN', 'USER'],
      default: 'USER',
    },

    // Excluded from normal queries (`select: false`) — a plain `User.find()`
    // or `.findById()` never accidentally carries these; call sites that
    // genuinely need them ask with `.select('+totpSecret +totpBackupCodeHashes')`.
    totpSecret: {
      type: String,
      default: null,
      select: false,
    },

    totpEnabled: {
      type: Boolean,
      default: false,
    },

    totpBackupCodeHashes: {
      type: [String],
      default: [],
      select: false,
    },
  },
  {
    timestamps: true,
  },
)

const User = mongoose.model<IUser>('User', userSchema)

export default User
