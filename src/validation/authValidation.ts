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