import { z } from 'zod'

/** Opaque client-generated id for the browser profile / device (Architecture §9). */
const deviceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .optional()

export const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must not exceed 30 characters')
    .regex(
      /^[a-zA-Z0-9_]+$/,
      'Username can only contain letters, numbers, and underscores',
    ),

  email: z
    .string()
    .trim()
    .email('Invalid email address')
    .max(100, 'Email must not exceed 100 characters'),

  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must not exceed 128 characters'),

  // The server is the source of truth for "did they actually agree" —
  // a checkbox the frontend forgot to require, or a direct API call, must
  // never be able to create an account without it.
  termsAccepted: z.literal(true, {
    message: 'You must agree to the Terms & Conditions',
  }),

  deviceId: deviceIdSchema,
})

export const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, 'Username or email is required'),

  password: z
    .string()
    .min(1, 'Password is required'),

  deviceId: deviceIdSchema,
})

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

export const updateProfileSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must not exceed 30 characters')
    .regex(
      /^[a-zA-Z0-9_]+$/,
      'Username can only contain letters, numbers, and underscores',
    )
    .optional(),

  email: z
    .string()
    .trim()
    .email('Invalid email address')
    .max(100, 'Email must not exceed 100 characters')
    .optional(),

  displayName: z
    .string()
    .trim()
    .max(60, 'Display name must not exceed 60 characters')
    .optional(),

  // null clears it.
  birthday: z
    .object({
      month: z.number().int().min(1).max(12),
      day: z.number().int().min(1).max(31),
      year: z
        .number()
        .int()
        .min(1900, 'That year looks too early')
        .max(new Date().getFullYear(), "That year hasn't happened yet")
        .nullable()
        .optional(),
    })
    .refine(
      // Feb 29 is a real birthday; otherwise the day must exist in that month.
      (b) => b.day <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][b.month - 1],
      { message: "That day doesn't exist in that month", path: ['day'] },
    )
    .refine((b) => !(b.year && b.month === 2 && b.day === 29 && !isLeapYear(b.year)), {
      message: `February 29 didn't happen that year`,
      path: ['day'],
    })
    .nullable()
    .optional(),

  paydays: z
    .array(z.number().int().min(1).max(31))
    .max(2, 'Up to two paydays')
    .optional(),
})

export const deleteAccountSchema = z.object({
  password: z
    .string()
    .min(1, 'Password is required'),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),

  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .max(128, 'New password must not exceed 128 characters'),
})

/** The second step of login, once a password checked out but the account needs a code too. */
export const verifyTwoFactorSchema = z.object({
  pendingToken: z.string().min(1),
  code: z.string().trim().min(1).max(20), // a 6-digit TOTP or an XXXXX-XXXXX backup code
  deviceId: deviceIdSchema,
})

/** Confirming a freshly-generated TOTP secret actually works before it's enforced. */
export const confirmTwoFactorSetupSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
})

/** Turning 2FA back off needs both factors that are already on the account. */
export const disableTwoFactorSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  code: z.string().trim().min(1).max(20),
})

export const verifyEmailSchema = z.object({
  token: z.string().trim().min(1, 'Missing token'),
})

/** Same flexible username-or-email lookup as login — never reveals which it matched. */
export const forgotPasswordSchema = z.object({
  identifier: z.string().trim().min(1, 'Username or email is required'),
})

/** Settings page — any subset of categories, only the ones actually changed. */
export const notificationPreferencesSchema = z.object({
  billReminders: z.boolean().optional(),
  shoppingUpdates: z.boolean().optional(),
  billUpdates: z.boolean().optional(),
  accountActivity: z.boolean().optional(),
  feedbackReports: z.boolean().optional(),
})

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1, 'Missing token'),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .max(128, 'New password must not exceed 128 characters'),
})

/** Sign in / sign up with Google — the ID token from Google's button. */
export const googleAuthSchema = z.object({
  credential: z.string().min(20, 'Missing Google credential').max(4096),
  // Shown beside the Google button ("By continuing you agree to…") — only
  // needed when this creates a brand-new account.
  termsAccepted: z.boolean().optional(),
  deviceId: deviceIdSchema,
})

