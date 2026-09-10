import { z } from 'zod'

const minorAmount = z
  .number()
  .int('Amount must be a whole number of minor units')
  .positive('Amount must be greater than zero')
  .max(1_000_000_000_00, 'Amount is too large')

const currency = z
  .string()
  .trim()
  .length(3)
  .transform((value) => value.toUpperCase())

export const createAccountSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  type: z.enum(['CASH', 'BANK', 'EWALLET', 'SAVINGS', 'OTHER']),
  currency: currency.optional(),
  openingBalanceMinor: z
    .number()
    .int('Opening balance must be a whole number of minor units')
    .optional(),
  isDefault: z.boolean().optional(),
})

export const updateAccountSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  type: z
    .enum(['CASH', 'BANK', 'EWALLET', 'SAVINGS', 'OTHER'])
    .optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  isDefault: z.literal(true).optional(),
})

export const createTransactionSchema = z
  .object({
    type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']),
    amountMinor: minorAmount,
    currency: currency.optional(),
    title: z.string().trim().min(1, 'Title is required').max(120),
    details: z.string().trim().max(2000).optional(),
    accountId: z.string().trim().min(1, 'An account is required'),
    destinationAccountId: z.string().trim().min(1).optional(),
    occurredAt: z.string().datetime().optional(),
  })
  .refine(
    (data) =>
      data.type !== 'TRANSFER' || Boolean(data.destinationAccountId),
    {
      message: 'A transfer needs a destination account',
      path: ['destinationAccountId'],
    },
  )
  .refine(
    (data) =>
      data.type === 'TRANSFER' || !data.destinationAccountId,
    {
      message: 'Only transfers have a destination account',
      path: ['destinationAccountId'],
    },
  )
  .refine(
    (data) =>
      data.type !== 'TRANSFER' ||
      data.accountId !== data.destinationAccountId,
    {
      message: 'A transfer needs two different accounts',
      path: ['destinationAccountId'],
    },
  )

export const updateTransactionSchema = z.object({
  amountMinor: minorAmount.optional(),
  title: z.string().trim().min(1).max(120).optional(),
  details: z.string().trim().max(2000).nullable().optional(),
  occurredAt: z.string().datetime().optional(),
  accountId: z.string().trim().min(1).optional(),
  destinationAccountId: z.string().trim().min(1).optional(),
})
