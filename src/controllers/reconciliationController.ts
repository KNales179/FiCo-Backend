import { NextFunction, Response } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import Account from '../models/Account.js'
import Reconciliation, {
  IReconciliation,
} from '../models/Reconciliation.js'
import { SpaceRequest } from '../middleware/spaceAccess.js'
import { computeBalances } from '../services/balanceService.js'

const serialize = (r: IReconciliation) => ({
  id: String(r._id),
  accountId: String(r.accountId),
  expectedMinor: r.expectedMinor,
  actualMinor: r.actualMinor,
  differenceMinor: r.differenceMinor,
  note: r.note ?? null,
  status: r.status,
  resolvedNote: r.resolvedNote ?? null,
  resolvedAt: r.resolvedAt ?? null,
  createdBy: String(r.createdBy),
  createdAt: r.createdAt,
})

const createSchema = z.object({
  accountId: z.string().trim().min(1),
  actualMinor: z.number().int(),
  note: z.string().trim().max(500).nullable().optional(),
})

const resolveSchema = z.object({
  resolvedNote: z.string().trim().max(500).nullable().optional(),
})

/**
 * POST /api/spaces/:spaceId/reconciliations  { accountId, actualMinor, note? }
 * Snapshots the account's derived balance as "expected", stores the counted
 * "actual", and records the difference. Never creates a transaction to make
 * the numbers match (Architecture §33).
 */
export const createReconciliation = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = createSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid reconciliation data',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const spaceId = req.space!._id
    const { accountId, actualMinor, note } = result.data

    const account = await Account.findOne({
      _id: mongoose.Types.ObjectId.isValid(accountId) ? accountId : null,
      spaceId,
      deletedAt: null,
    })
    if (!account) {
      return res
        .status(404)
        .json({ success: false, message: 'Account not found' })
    }

    const balances = await computeBalances(String(spaceId))
    const expectedMinor =
      balances.get(String(account._id))?.balanceMinor ??
      account.openingBalanceMinor

    const reconciliation = await Reconciliation.create({
      spaceId,
      accountId: account._id,
      expectedMinor,
      actualMinor,
      differenceMinor: actualMinor - expectedMinor,
      note: note ?? null,
      status: 'OPEN',
      createdBy: req.user!.id,
    })

    return res.status(201).json({
      success: true,
      message: 'Cash check saved',
      reconciliation: serialize(reconciliation),
    })
  } catch (error) {
    next(error)
  }
}

/** GET /api/spaces/:spaceId/reconciliations  (?accountId= , ?status=) */
export const listReconciliations = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const filter: Record<string, unknown> = {
      spaceId: req.space!._id,
      deletedAt: null,
    }
    if (
      typeof req.query.accountId === 'string' &&
      mongoose.Types.ObjectId.isValid(req.query.accountId)
    ) {
      filter.accountId = req.query.accountId
    }
    if (req.query.status === 'OPEN' || req.query.status === 'RESOLVED') {
      filter.status = req.query.status
    }

    const rows = await Reconciliation.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)

    return res.json({
      success: true,
      reconciliations: rows.map(serialize),
    })
  } catch (error) {
    next(error)
  }
}

/** PATCH /api/spaces/:spaceId/reconciliations/:id  { resolvedNote? } — mark resolved. */
export const resolveReconciliation = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = resolveSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid data',
      })
    }

    const id = String(req.params.id)
    const reconciliation = await Reconciliation.findOne({
      _id: mongoose.Types.ObjectId.isValid(id) ? id : null,
      spaceId: req.space!._id,
      deletedAt: null,
    })
    if (!reconciliation) {
      return res
        .status(404)
        .json({ success: false, message: 'Reconciliation not found' })
    }

    reconciliation.status = 'RESOLVED'
    reconciliation.resolvedNote = result.data.resolvedNote ?? null
    reconciliation.resolvedAt = new Date()
    await reconciliation.save()

    return res.json({
      success: true,
      message: 'Marked resolved',
      reconciliation: serialize(reconciliation),
    })
  } catch (error) {
    next(error)
  }
}
