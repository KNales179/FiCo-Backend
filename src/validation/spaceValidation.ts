import { z } from 'zod'

const spaceName = z
  .string()
  .trim()
  .min(1, 'Space name is required')
  .max(60, 'Space name must not exceed 60 characters')

export const createSpaceSchema = z.object({
  name: spaceName,
})

export const updateSpaceSchema = z.object({
  name: spaceName,
})

export const addMemberSchema = z.object({
  /** Username or email of an existing Fico user. */
  identifier: z.string().trim().min(1, 'A username or email is required'),
  role: z.enum(['EDITOR', 'VIEWER']).default('VIEWER'),
})

export const updateMemberSchema = z.object({
  role: z.enum(['EDITOR', 'VIEWER']),
})
