import { z } from 'zod'

const spaceName = z
  .string()
  .trim()
  .min(1, 'Space name is required')
  .max(60, 'Space name must not exceed 60 characters')

/** Mirrors `SUPPORTED_CURRENCIES` in the frontend's `domain/money.ts`. */
const SUPPORTED_CURRENCIES = [
  'PHP',
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'AED',
  'SAR',
  'SGD',
  'HKD',
  'AUD',
  'CAD',
  'CNY',
  'INR',
  'KRW',
] as const

const currencyCode = z.enum(SUPPORTED_CURRENCIES)

export const createSpaceSchema = z.object({
  name: spaceName,
})

/** Rename and/or change currency (owner only — enforced by `requireSpaceMember('OWNER')`). */
export const updateSpaceSchema = z
  .object({
    name: spaceName.optional(),
    currency: currencyCode.optional(),
  })
  .refine((data) => data.name !== undefined || data.currency !== undefined, {
    message: 'Nothing to update',
  })

export const addMemberSchema = z.object({
  /** Username or email of an existing Fico user. Everyone joins as a full member. */
  identifier: z.string().trim().min(1, 'A username or email is required'),
})
