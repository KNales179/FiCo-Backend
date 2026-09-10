import { z } from 'zod'

const amountMinor = z.number().int().min(0).max(1_000_000_000_00)

export const createBillSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  recurrence: z.enum(['MONTHLY', 'YEARLY']),
  billType: z.enum(['FIXED', 'VARIABLE']),
  expectedAmountMinor: amountMinor.nullable().optional(),
  nextDueDate: z.string().datetime(),
  categoryName: z.string().trim().max(60).nullable().optional(),
  paymentAccountId: z.string().trim().min(1).nullable().optional(),
  tracksElectricity: z.boolean().optional(),
})

export const updateBillSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  recurrence: z.enum(['MONTHLY', 'YEARLY']).optional(),
  billType: z.enum(['FIXED', 'VARIABLE']).optional(),
  expectedAmountMinor: amountMinor.nullable().optional(),
  nextDueDate: z.string().datetime().optional(),
  categoryName: z.string().trim().max(60).nullable().optional(),
  paymentAccountId: z.string().trim().min(1).nullable().optional(),
  active: z.boolean().optional(),
  tracksElectricity: z.boolean().optional(),
})

const nonNegInt = z.number().int().min(0)

export const electricityDetailSchema = z.object({
  consumptionKwh: z.number().min(0).nullable().optional(),
  energyChargeMinor: nonNegInt.nullable().optional(),
  transmissionMinor: nonNegInt.nullable().optional(),
  distributionMinor: nonNegInt.nullable().optional(),
  taxesMinor: nonNegInt.nullable().optional(),
  otherChargesMinor: nonNegInt.nullable().optional(),
})

export const payBillSchema = z.object({
  amountMinor: z.number().int().positive('Enter the amount paid'),
  accountId: z.string().trim().min(1).optional(),
  paidAt: z.string().datetime().optional(),
  electricity: electricityDetailSchema.optional(),
})
