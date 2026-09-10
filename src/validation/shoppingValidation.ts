import { z } from 'zod'

const priceMinor = z.number().int().min(0).max(1_000_000_000_00)

export const createListSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120),
  plannedBudgetMinor: priceMinor.nullable().optional(),
  plannedAt: z.string().datetime().nullable().optional(),
})

export const updateListSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  plannedBudgetMinor: priceMinor.nullable().optional(),
  status: z.enum(['ACTIVE', 'CANCELLED']).optional(),
})

export const addItemSchema = z.object({
  name: z.string().trim().min(1, 'Item name is required').max(120),
  plannedPriceMinor: priceMinor.nullable().optional(),
  quantity: z.number().int().min(1).max(100000).optional(),
  addedDuringTrip: z.boolean().optional(),
})

export const updateItemSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  plannedPriceMinor: priceMinor.nullable().optional(),
  actualPriceMinor: priceMinor.nullable().optional(),
  quantity: z.number().int().min(1).max(100000).optional(),
  checked: z.boolean().optional(),
})
