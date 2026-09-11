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
})

export const adminSetRoleSchema = z.object({
  role: z.enum(['ADMIN', 'USER']),
  confirmPassword: z.string().min(1, "Confirm it's you — enter your own password"),
})
