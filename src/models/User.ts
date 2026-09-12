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
  /** Confirmed ownership of the email on file — informational only (shown to
   *  an admin, and to the account itself as a reminder); never blocks
   *  login or any feature. Absent on a document means `false` via the
   *  schema default, which is exactly the point for every account that
   *  existed before this feature did. */
  emailVerified: boolean
  emailVerificationTokenHash?: string | null
  emailVerificationExpiresAt?: Date | null
  passwordResetTokenHash?: string | null
  passwordResetExpiresAt?: Date | null
  /** Cloudinary-hosted, same as receipt attachments. Null until uploaded. */
  avatarUrl?: string | null
  avatarPublicId?: string | null
  /** Which categories of push notification this account wants. Every
   *  category defaults true; absent on a document (any account from before
   *  this existed) resolves to the same all-true default via the schema,
   *  not to "muted". */
  notificationPreferences: {
    billReminders: boolean
    shoppingUpdates: boolean
    billUpdates: boolean
    accountActivity: boolean
    /** Only meaningful for an admin account, but harmless on every other one. */
    feedbackReports: boolean
  }
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

    emailVerified: {
      type: Boolean,
      default: false,
    },

    // Same `select: false` convention as the TOTP secret above — a plain
    // `User.find()`/`.findById()` never carries these; the controllers that
    // actually validate a token ask for them explicitly.
    emailVerificationTokenHash: {
      type: String,
      default: null,
      select: false,
    },
    emailVerificationExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
    passwordResetTokenHash: {
      type: String,
      default: null,
      select: false,
    },
    passwordResetExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },

    avatarUrl: {
      type: String,
      default: null,
    },
    avatarPublicId: {
      type: String,
      default: null,
      select: false,
    },

    notificationPreferences: {
      type: {
        billReminders: { type: Boolean, default: true },
        shoppingUpdates: { type: Boolean, default: true },
        billUpdates: { type: Boolean, default: true },
        accountActivity: { type: Boolean, default: true },
        feedbackReports: { type: Boolean, default: true },
      },
      default: () => ({
        billReminders: true,
        shoppingUpdates: true,
        billUpdates: true,
        accountActivity: true,
        feedbackReports: true,
      }),
    },
  },
  {
    timestamps: true,
  },
)

const User = mongoose.model<IUser>('User', userSchema)

export default User
