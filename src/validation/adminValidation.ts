import { z } from 'zod'

/**
 * An admin acting on *another* account re-confirms their own current
 * password on every sensitive action (setting someone's password,
 * granting/revoking admin) — the same step-up check `deleteMe` already
 * asks a person for on their own account, so a hijacked-but-not-fully-
 * compromised admin session can't do lasting damage silently.
 */
export const adminSetPasswordSchema = z.object({
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .max(128, 'New password must not exceed 128 characters'),
  confirmPassword: z.string().min(1, "Confirm it's you — enter your own password"),
  reason: z.string().trim().max(500).optional(),
})

export const adminSetRoleSchema = z.object({
  role: z.enum(['ADMIN', 'USER']),
  confirmPassword: z.string().min(1, "Confirm it's you — enter your own password"),
  reason: z.string().trim().max(500).optional(),
})

/** Turning off someone's 2FA (they lost their phone and backup codes). */
export const adminResetTwoFactorSchema = z.object({
  confirmPassword: z.string().min(1, "Confirm it's you — enter your own password"),
  reason: z.string().trim().max(500).optional(),
})

const confirmPassword = z.string().min(1, "Confirm it's you — enter your own password")
const reason = z.string().trim().min(3, 'Give a short reason — they’ll see it').max(500)
const optionalReason = z.string().trim().max(500).optional()

/** A message from an admin to one user — signed, or anonymous ("Fico Admin Team"). */
export const adminNoticeSchema = z.object({
  title: z.string().trim().max(120).optional(),
  message: z.string().trim().min(1, 'Write a message').max(2000),
  anonymous: z.boolean().default(false),
})

/** Sign every device out; the reason is shown to them on the sign-in screen. */
export const adminSignOutSchema = z.object({
  reason: optionalReason,
})

/** Block sign-in for a while (hours), or until lifted (null). */
export const adminRestrictSchema = z.object({
  reason,
  durationHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 366)
    .nullable(),
  confirmPassword,
})

export const adminUnrestrictSchema = z.object({
  note: optionalReason,
})

export const adminDeleteUserSchema = z.object({
  reason,
  confirmPassword,
})
