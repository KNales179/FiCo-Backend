import mongoose from 'mongoose'
import SyncRecord from '../models/SyncRecord.js'

export type AnalyticsPeriod =
  | 'THIS_MONTH'
  | 'LAST_MONTH'
  | 'THIS_YEAR'
  | 'LAST_YEAR'
  | 'ALL_TIME'
  | 'CUSTOM'

export interface DateRange {
  fromIso: string
  toIso: string
}

export const resolveRange = (
  period: AnalyticsPeriod,
  custom?: Partial<DateRange>,
  now = new Date(),
): DateRange => {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()

  switch (period) {
    case 'THIS_MONTH':
      return {
        fromIso: new Date(Date.UTC(y, m, 1)).toISOString(),
        toIso: new Date(Date.UTC(y, m + 1, 1) - 1).toISOString(),
      }
    case 'LAST_MONTH':
      return {
        fromIso: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
        toIso: new Date(Date.UTC(y, m, 1) - 1).toISOString(),
      }
    case 'THIS_YEAR':
      return {
        fromIso: new Date(Date.UTC(y, 0, 1)).toISOString(),
        toIso: new Date(Date.UTC(y + 1, 0, 1) - 1).toISOString(),
      }
    case 'LAST_YEAR':
      return {
        fromIso: new Date(Date.UTC(y - 1, 0, 1)).toISOString(),
        toIso: new Date(Date.UTC(y, 0, 1) - 1).toISOString(),
      }
    case 'CUSTOM':
      return {
        fromIso:
          custom?.fromIso ?? new Date(Date.UTC(y, m, 1)).toISOString(),
        toIso: custom?.toIso ?? now.toISOString(),
      }
    case 'ALL_TIME':
    default:
      return {
        fromIso: new Date(0).toISOString(),
        toIso: new Date(Date.UTC(y + 100, 0, 1)).toISOString(),
      }
  }
}

export interface SpaceAnalytics {
  range: DateRange
  currency: string
  incomeMinor: number
  expenseMinor: number
  netMinor: number
  transferMinor: number
  expensePctOfIncome: number
  billSpendMinor: number
  transactionCount: number
  byCategory: Array<{ name: string; amountMinor: number; pct: number }>
  byMonth: Array<{
    month: string
    incomeMinor: number
    expenseMinor: number
  }>
  shopping: {
    plannedMinor: number
    actualMinor: number
    listCount: number
  }
}

/**
 * Space-scoped analytics (Roadmap Phase 15). Computed on the server so every
 * member of a shared space sees the same numbers. Transfers never count as
 * income or expense; categories come from each transaction's `categoryName`
 * snapshot.
 */
interface TxnLike {
  type?: string
  amountMinor?: number
  categoryName?: string | null
  sourceType?: string
  occurredAt?: string
  currency?: string
  visibility?: string
}

export const computeSpaceAnalytics = async (
  spaceId: mongoose.Types.ObjectId,
  range: DateRange,
  currency = 'PHP',
): Promise<SpaceAnalytics> => {
  const fromIso = range.fromIso
  const toIso = range.toIso

  // Reads from the replicated store (Phase 18). Private records are each
  // member's own business — never in shared analytics.
  const txnRows = await SyncRecord.find({
    spaceId,
    entityType: 'transaction',
    deletedAt: null,
  })
    .select('payload')
    .lean()

  const transactions: TxnLike[] = txnRows
    .map((r) => r.payload as TxnLike)
    .filter(
      (t) =>
        (t.currency ?? 'PHP') === currency &&
        (t.visibility ?? 'SPACE') !== 'PRIVATE' &&
        typeof t.occurredAt === 'string' &&
        t.occurredAt >= fromIso &&
        t.occurredAt <= toIso,
    )

  let incomeMinor = 0
  let expenseMinor = 0
  let transferMinor = 0
  let billSpendMinor = 0
  const categoryMap = new Map<string, number>()
  const monthMap = new Map<
    string,
    { month: string; incomeMinor: number; expenseMinor: number }
  >()

  for (const txn of transactions) {
    const amount = txn.amountMinor ?? 0
    const mk = (txn.occurredAt as string).slice(0, 7)
    const month =
      monthMap.get(mk) ?? { month: mk, incomeMinor: 0, expenseMinor: 0 }

    if (txn.type === 'INCOME') {
      incomeMinor += amount
      month.incomeMinor += amount
    } else if (txn.type === 'EXPENSE') {
      expenseMinor += amount
      month.expenseMinor += amount
      if (txn.sourceType === 'BILL_PAYMENT') {
        billSpendMinor += amount
      }
      const cat = txn.categoryName?.trim() || 'Uncategorized'
      categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + amount)
    } else if (txn.type === 'TRANSFER') {
      transferMinor += amount
    }

    monthMap.set(mk, month)
  }

  // Shopping planned vs actual for lists completed in range.
  interface ListLike {
    id?: string
    status?: string
    visibility?: string
    completedAt?: string
    updatedAt?: string
  }
  interface ItemLike {
    shoppingListId?: string
    plannedPriceMinor?: number | null
    actualPriceMinor?: number | null
    checked?: boolean
  }

  const listRows = await SyncRecord.find({
    spaceId,
    entityType: 'shoppingList',
    deletedAt: null,
  })
    .select('payload')
    .lean()

  const completedIds = new Set(
    listRows
      .map((r) => r.payload as ListLike)
      .filter((l) => {
        const done = l.completedAt ?? l.updatedAt ?? ''
        return (
          l.status === 'COMPLETED' &&
          (l.visibility ?? 'SPACE') !== 'PRIVATE' &&
          done >= fromIso &&
          done <= toIso
        )
      })
      .map((l) => l.id)
      .filter(Boolean) as string[],
  )

  let plannedMinor = 0
  let actualMinor = 0
  if (completedIds.size > 0) {
    const itemRows = await SyncRecord.find({
      spaceId,
      entityType: 'shoppingItem',
      deletedAt: null,
    })
      .select('payload')
      .lean()

    for (const row of itemRows) {
      const item = row.payload as ItemLike
      if (!item.shoppingListId || !completedIds.has(item.shoppingListId)) {
        continue
      }
      plannedMinor += item.plannedPriceMinor ?? 0
      if (item.checked) {
        actualMinor += item.actualPriceMinor ?? item.plannedPriceMinor ?? 0
      }
    }
  }

  const lists = { length: completedIds.size }

  const byCategory = [...categoryMap.entries()]
    .map(([name, amountMinor]) => ({
      name,
      amountMinor,
      pct: expenseMinor > 0 ? (amountMinor / expenseMinor) * 100 : 0,
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor)

  return {
    range,
    currency,
    incomeMinor,
    expenseMinor,
    netMinor: incomeMinor - expenseMinor,
    transferMinor,
    expensePctOfIncome:
      incomeMinor > 0 ? (expenseMinor / incomeMinor) * 100 : 0,
    billSpendMinor,
    transactionCount: transactions.length,
    byCategory,
    byMonth: [...monthMap.values()].sort((a, b) =>
      a.month.localeCompare(b.month),
    ),
    shopping: { plannedMinor, actualMinor, listCount: lists.length },
  }
}
