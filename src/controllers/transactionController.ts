import { NextFunction, Response } from 'express'
import mongoose from 'mongoose'
import Account from '../models/Account.js'
import Transaction, { ITransaction } from '../models/Transaction.js'
import { SpaceRequest } from '../middleware/spaceAccess.js'
import { categoryNameById } from '../services/categoryService.js'
import { suggestForName } from '../services/itemIntelligenceService.js'
import { visibilityFilter } from '../services/visibility.js'
import {
  createTransactionSchema,
  updateTransactionSchema,
} from '../validation/moneyValidation.js'

const serializeTransaction = (txn: ITransaction) => ({
  id: String(txn._id),
  spaceId: String(txn.spaceId),
  type: txn.type,
  amountMinor: txn.amountMinor,
  currency: txn.currency,
  title: txn.title,
  details: txn.details ?? null,
  categoryId: txn.categoryId ? String(txn.categoryId) : null,
  categoryName: txn.categoryName ?? null,
  accountId: String(txn.accountId),
  destinationAccountId: txn.destinationAccountId
    ? String(txn.destinationAccountId)
    : null,
  occurredAt: txn.occurredAt,
  sourceType: txn.sourceType,
  sourceId: txn.sourceId ?? null,
  visibility: txn.visibility,
  createdBy: String(txn.createdBy),
  createdAt: txn.createdAt,
  updatedAt: txn.updatedAt,
})

/** Loads an ACTIVE, non-deleted account in this space, or returns an error string. */
const loadSpaceAccount = async (
  spaceId: mongoose.Types.ObjectId,
  accountId: string,
) => {
  if (!mongoose.Types.ObjectId.isValid(accountId)) {
    return { error: 'Account not found' as const }
  }

  const account = await Account.findOne({
    _id: accountId,
    spaceId,
    deletedAt: null,
  })

  if (!account) {
    return { error: 'Account not found' as const }
  }

  if (account.status !== 'ACTIVE') {
    return { error: 'That account is archived' as const }
  }

  return { account }
}

/**
 * Server-side financial validation (Architecture §49). The client is never
 * trusted for this: accounts must belong to the space and be usable, transfers
 * need two distinct accounts, and currencies must match (no FX in the MVP).
 */
const resolveTransactionAccounts = async (
  spaceId: mongoose.Types.ObjectId,
  input: {
    type: 'INCOME' | 'EXPENSE' | 'TRANSFER'
    accountId: string
    destinationAccountId?: string
    currency?: string
  },
) => {
  const source = await loadSpaceAccount(spaceId, input.accountId)
  if ('error' in source) return { error: source.error }

  const currency = (input.currency ?? source.account.currency).toUpperCase()
  if (currency !== source.account.currency) {
    return {
      error: `Amount currency must match the account (${source.account.currency})`,
    }
  }

  if (input.type !== 'TRANSFER') {
    return { source: source.account, currency }
  }

  const destination = await loadSpaceAccount(
    spaceId,
    input.destinationAccountId!,
  )
  if ('error' in destination) return { error: destination.error }

  if (destination.account.currency !== currency) {
    return { error: 'Both transfer accounts must use the same currency' }
  }

  return {
    source: source.account,
    destination: destination.account,
    currency,
  }
}

/** GET /api/spaces/:spaceId/transactions */
export const listTransactions = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const spaceId = req.space!._id

    const limit = Math.min(
      Math.max(Number(req.query.limit) || 50, 1),
      200,
    )

    const type =
      typeof req.query.type === 'string' ? req.query.type : null
    const accountId =
      typeof req.query.accountId === 'string' &&
      mongoose.Types.ObjectId.isValid(req.query.accountId)
        ? req.query.accountId
        : null
    const before =
      typeof req.query.before === 'string' &&
      !Number.isNaN(Date.parse(req.query.before))
        ? new Date(req.query.before)
        : null

    const and: Record<string, unknown>[] = [
      visibilityFilter(req.user!.id),
    ]
    if (accountId) {
      and.push({
        $or: [{ accountId }, { destinationAccountId: accountId }],
      })
    }

    const filter: Record<string, unknown> = {
      spaceId,
      deletedAt: null,
      $and: and,
    }
    if (type) filter.type = type
    if (before) filter.occurredAt = { $lt: before }

    const transactions = await Transaction.find(filter)
      .sort({ occurredAt: -1, _id: -1 })
      .limit(limit + 1)

    const hasMore = transactions.length > limit
    const page = hasMore ? transactions.slice(0, limit) : transactions

    return res.json({
      success: true,
      transactions: page.map(serializeTransaction),
      nextBefore: hasMore
        ? page[page.length - 1].occurredAt.toISOString()
        : null,
    })
  } catch (error) {
    next(error)
  }
}

/** POST /api/spaces/:spaceId/transactions */
export const createTransaction = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = createTransactionSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction data',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const data = result.data
    const spaceId = req.space!._id

    const resolved = await resolveTransactionAccounts(spaceId, data)
    if ('error' in resolved) {
      return res
        .status(422)
        .json({ success: false, message: resolved.error })
    }

    // Category: an explicit pick wins; otherwise auto-fill from a known item
    // with the same name (Product Spec §10, §38). Snapshot the name so history
    // never changes when a category is renamed.
    let categoryId: string | null = data.categoryId ?? null
    let categoryName: string | null = await categoryNameById(categoryId)
    if (!categoryName && data.type === 'EXPENSE') {
      const suggestion = await suggestForName(spaceId, data.title)
      categoryId = suggestion?.categoryId ?? null
      categoryName = suggestion?.category ?? null
    }

    const txn = await Transaction.create({
      spaceId,
      type: data.type,
      amountMinor: data.amountMinor,
      currency: resolved.currency,
      title: data.title,
      details: data.details,
      categoryId,
      categoryName,
      accountId: data.accountId,
      destinationAccountId:
        data.type === 'TRANSFER' ? data.destinationAccountId : null,
      occurredAt: data.occurredAt
        ? new Date(data.occurredAt)
        : new Date(),
      sourceType: 'MANUAL',
      visibility: data.visibility ?? 'SPACE',
      createdBy: req.user!.id,
    })

    return res.status(201).json({
      success: true,
      message: 'Transaction recorded',
      transaction: serializeTransaction(txn),
    })
  } catch (error) {
    next(error)
  }
}

/** GET /api/spaces/:spaceId/transactions/:transactionId */
export const getTransaction = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const getQuery: Record<string, unknown> = {
      _id: req.params.transactionId,
      spaceId: req.space!._id,
      deletedAt: null,
      ...visibilityFilter(req.user!.id),
    }
    const txn = await Transaction.findOne(getQuery).catch(() => null)

    if (!txn) {
      return res
        .status(404)
        .json({ success: false, message: 'Transaction not found' })
    }

    return res.json({
      success: true,
      transaction: serializeTransaction(txn),
    })
  } catch (error) {
    next(error)
  }
}

/** PATCH /api/spaces/:spaceId/transactions/:transactionId */
export const updateTransaction = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = updateTransactionSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction data',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const spaceId = req.space!._id

    const updateQuery: Record<string, unknown> = {
      _id: req.params.transactionId,
      spaceId,
      deletedAt: null,
      ...visibilityFilter(req.user!.id),
    }
    const txn = await Transaction.findOne(updateQuery).catch(() => null)

    if (!txn) {
      return res
        .status(404)
        .json({ success: false, message: 'Transaction not found' })
    }

    const data = result.data

    // Only the creator may change a record's privacy.
    if (
      data.visibility !== undefined &&
      String(txn.createdBy) === req.user!.id
    ) {
      txn.visibility = data.visibility
    }
    if (data.categoryId !== undefined) {
      txn.categoryId = data.categoryId
        ? new mongoose.Types.ObjectId(data.categoryId)
        : null
      txn.categoryName = await categoryNameById(data.categoryId)
    }

    const nextAccountId = data.accountId ?? String(txn.accountId)
    const nextDestinationId =
      data.destinationAccountId ??
      (txn.destinationAccountId
        ? String(txn.destinationAccountId)
        : undefined)

    if (data.accountId || data.destinationAccountId) {
      const resolved = await resolveTransactionAccounts(spaceId, {
        type: txn.type,
        accountId: nextAccountId,
        destinationAccountId: nextDestinationId,
        currency: txn.currency,
      })
      if ('error' in resolved) {
        return res
          .status(422)
          .json({ success: false, message: resolved.error })
      }

      if (
        txn.type === 'TRANSFER' &&
        nextAccountId === nextDestinationId
      ) {
        return res.status(422).json({
          success: false,
          message: 'A transfer needs two different accounts',
        })
      }

      txn.accountId = new mongoose.Types.ObjectId(nextAccountId)
      if (txn.type === 'TRANSFER' && nextDestinationId) {
        txn.destinationAccountId = new mongoose.Types.ObjectId(
          nextDestinationId,
        )
      }
    }

    if (data.amountMinor !== undefined) txn.amountMinor = data.amountMinor
    if (data.title !== undefined) txn.title = data.title
    if (data.details !== undefined) {
      txn.details = data.details ?? undefined
    }
    if (data.occurredAt !== undefined) {
      txn.occurredAt = new Date(data.occurredAt)
    }

    await txn.save()

    return res.json({
      success: true,
      message: 'Transaction updated',
      transaction: serializeTransaction(txn),
    })
  } catch (error) {
    next(error)
  }
}

/** DELETE /api/spaces/:spaceId/transactions/:transactionId — soft delete. */
export const deleteTransaction = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const deleteQuery: Record<string, unknown> = {
      _id: req.params.transactionId,
      spaceId: req.space!._id,
      deletedAt: null,
      ...visibilityFilter(req.user!.id),
    }
    const txn = await Transaction.findOne(deleteQuery).catch(() => null)

    if (!txn) {
      return res
        .status(404)
        .json({ success: false, message: 'Transaction not found' })
    }

    txn.deletedAt = new Date()
    await txn.save()

    return res.json({ success: true, message: 'Transaction deleted' })
  } catch (error) {
    next(error)
  }
}
