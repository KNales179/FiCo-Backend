import mongoose, { Document, Schema } from 'mongoose'

export type UserRole = 'ADMIN' | 'USER'

export interface IUser extends Document {
  username: string
  email: string
  passwordHash: string
  /** Google account id ("sub"), once the account has signed in with Google. */
  googleId?: string | null
  displayName?: string
  /** Optional, typed in by the person. Year is optional too — some people
   *  would rather not say. Used for a birthday greeting and a budget nudge. */
  birthday?: { month: number; day: number; year?: number | null } | null
  /** Days of the month they usually get paid (1–31; 31 = last day of the
   *  month), at most two — e.g. [15, 31] for the common kinsenas pay. */
  paydays: number[]
  status: 'ACTIVE' | 'DISABLED'
  /** Set by an admin: can't sign in until `until` (null = until lifted). */
  restriction?: {
    reason: string
    until: Date | null
    byId: mongoose.Types.ObjectId
    at: Date
  } | null
  /** Why an admin deleted (disabled) this account, if one did. */
  deletedByAdmin?: { reason: string; byId: mongoose.Types.ObjectId; at: Date } | null
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
  /** When this account agreed to the Terms & Conditions — required at
   *  registration (§ registerSchema); an audit trail, never re-checked to
   *  gate anything (an existing account isn't retroactively logged out
   *  because the terms text changed later). Absent on an account that
   *  predates this field. */
  termsAcceptedAt?: Date | null
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

    // Set when the account signs in with Google. Sparse so the many
    // password-only accounts (no googleId) don't collide on the index.
    googleId: {
      type: String,
      default: undefined,
      index: { unique: true, sparse: true },
    },

    displayName: {
      type: String,
      trim: true,
      maxlength: 60,
      default: null,
    },

    birthday: {
      type: new Schema(
        {
          month: { type: Number, min: 1, max: 12, required: true },
          day: { type: Number, min: 1, max: 31, required: true },
          year: { type: Number, min: 1900, max: 2100, default: null },
        },
        { _id: false },
      ),
      default: undefined,
    },

    paydays: {
      type: [{ type: Number, min: 1, max: 31 }],
      default: [],
    },

    status: {
      type: String,
      enum: ['ACTIVE', 'DISABLED'],
      default: 'ACTIVE',
    },

    restriction: {
      type: new Schema(
        {
          reason: { type: String, required: true, maxlength: 500 },
          until: { type: Date, default: null },
          byId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          at: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },

    deletedByAdmin: {
      type: new Schema(
        {
          reason: { type: String, required: true, maxlength: 500 },
          byId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          at: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
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

    termsAcceptedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
)

const User = mongoose.model<IUser>('User', userSchema)

export default User
