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
  /** Username or email of an existing Fico user. Everyone joins as a full member. */
  identifier: z.string().trim().min(1, 'A username or email is required'),
})
