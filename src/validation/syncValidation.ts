import { z } from 'zod'

/**
 * Lightweight structural checks on sync payloads. This is not full domain
 * validation (no balance derivation, no cross-record rules — the local-first
 * client owns those); it stops obviously malformed or hostile data from
 * entering a shared space's replicated store.
 */

const id = z.string().min(1).max(120)
const minorInt = z.number().int().min(-1_000_000_000_00).max(1_000_000_000_00)
const nonNegInt = z.number().int().min(0).max(1_000_000_000_00)
const iso = z.string().min(1)
const visibility = z.enum(['SPACE', 'PRIVATE']).optional()
const base = {
  id,
  createdAt: iso,
  updatedAt: iso,
  deletedAt: z.string().nullable().optional(),
}

const schemas: Record<string, z.ZodObject<z.ZodRawShape>> = {
  account: z.object({
    ...base,
    spaceId: id,
    name: z.string().min(1).max(60),
    type: z.enum(['CASH', 'BANK', 'EWALLET', 'SAVINGS', 'OTHER']),
    currency: z.string().length(3),
    openingBalanceMinor: minorInt,
    status: z.enum(['ACTIVE', 'ARCHIVED']),
    isDefault: z.boolean().optional(),
  }),
  transaction: z.object({
    ...base,
    spaceId: id,
    type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']),
    amountMinor: nonNegInt.refine((n) => n > 0, 'amount must be > 0'),
    currency: z.string().length(3),
    title: z.string().min(1).max(120),
    accountId: id,
    destinationAccountId: z.string().nullable().optional(),
    occurredAt: iso,
    categoryId: z.string().nullable().optional(),
    categoryName: z.string().max(60).nullable().optional(),
    sourceType: z.string().optional(),
    sourceId: z.string().nullable().optional(),
    visibility,
    createdBy: id,
  }),
  category: z.object({
    ...base,
    spaceId: id,
    name: z.string().min(1).max(40),
    normalizedName: z.string().min(1),
    kind: z.enum(['EXPENSE', 'INCOME']),
    archived: z.boolean(),
    tracksItems: z.boolean().optional(),
    createdBy: id,
  }),
  shoppingList: z.object({
    ...base,
    spaceId: id,
    title: z.string().min(1).max(120),
    status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']),
    plannedBudgetMinor: z.number().int().nullable().optional(),
    visibility,
    createdBy: id,
  }),
  shoppingItem: z.object({
    ...base,
    spaceId: id,
    shoppingListId: id,
    name: z.string().min(1).max(120),
    plannedPriceMinor: z.number().int().nullable().optional(),
    actualPriceMinor: z.number().int().nullable().optional(),
    quantity: z.number().int().min(1),
    checked: z.boolean(),
    purchased: z.boolean(),
    addedDuringTrip: z.boolean(),
    itemProfileId: z.string().nullable().optional(),
    transactionId: z.string().nullable().optional(),
    createdBy: id,
  }),
  itemProfile: z.object({
    ...base,
    spaceId: id,
    normalizedName: z.string().min(1),
    displayName: z.string().min(1).max(120),
    categoryId: z.string().nullable().optional(),
  }),
  priceHistory: z.object({
    ...base,
    itemProfileId: id,
    amountMinor: nonNegInt,
    purchasedAt: iso,
    transactionId: z.string().nullable().optional(),
  }),
  bill: z.object({
    ...base,
    spaceId: id,
    name: z.string().min(1).max(80),
    recurrence: z.enum(['MONTHLY', 'YEARLY']),
    billType: z.enum(['FIXED', 'VARIABLE']),
    expectedAmountMinor: z.number().int().nullable().optional(),
    nextDueDate: iso,
    active: z.boolean(),
    visibility,
    tracksElectricity: z.boolean(),
    categoryName: z.string().nullable().optional(),
    createdBy: z.string().optional(),
  }),
  billPayment: z.object({
    ...base,
    spaceId: id,
    billId: id,
    amountMinor: nonNegInt.refine((n) => n > 0),
    paidAt: iso,
    periodKey: z.string().min(1),
    accountId: id,
    transactionId: z.string().nullable().optional(),
    createdBy: id,
  }),
  electricityRecord: z.object({
    ...base,
    spaceId: id,
    billId: id,
    billPaymentId: id,
    billingPeriod: z.string().min(1),
    amountMinor: nonNegInt,
    consumptionKwh: z.number().min(0).nullable().optional(),
    energyChargeMinor: z.number().int().nullable().optional(),
    transmissionMinor: z.number().int().nullable().optional(),
    distributionMinor: z.number().int().nullable().optional(),
    taxesMinor: z.number().int().nullable().optional(),
    otherChargesMinor: z.number().int().nullable().optional(),
  }),
  reconciliation: z.object({
    ...base,
    spaceId: id,
    accountId: id,
    expectedMinor: minorInt,
    actualMinor: minorInt,
    differenceMinor: minorInt,
    note: z.string().max(500).nullable().optional(),
    status: z.enum(['OPEN', 'RESOLVED']),
    resolvedNote: z.string().max(500).nullable().optional(),
    resolvedAt: z.string().nullable().optional(),
    createdBy: id,
  }),
}

export const SYNCABLE_ENTITY_TYPES = Object.keys(schemas)

export const validateSyncPayload = (
  entityType: string,
  payload: unknown,
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string } => {
  const schema = schemas[entityType]
  if (!schema) {
    return { ok: false, error: `Unknown entity type "${entityType}"` }
  }
  const result = schema.loose().safeParse(payload)
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues[0]?.message ?? 'Invalid payload',
    }
  }
  return { ok: true, value: result.data as Record<string, unknown> }
}

export const pushSchema = z.object({
  deviceId: z.string().max(120).optional(),
  events: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        entityType: z.string().min(1).max(60),
        entityId: z.string().min(1).max(120),
        operation: z.string().min(1).max(20),
        payload: z.unknown(),
        clientVersion: z.number().int().min(1).optional(),
        baseVersion: z.number().int().min(0).optional(),
      }),
    )
    .max(500),
})
