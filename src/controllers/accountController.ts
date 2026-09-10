import { NextFunction, Response } from 'express'
import Account, { IAccount } from '../models/Account.js'
import Transaction from '../models/Transaction.js'
import { SpaceRequest } from '../middleware/spaceAccess.js'
import { computeBalances } from '../services/balanceService.js'
import {
  createAccountSchema,
  updateAccountSchema,
} from '../validation/moneyValidation.js'

const serializeAccount = (
  account: IAccount,
  balanceMinor?: number,
) => ({
  id: String(account._id),
  spaceId: String(account.spaceId),
  name: account.name,
  type: account.type,
  currency: account.currency,
  openingBalanceMinor: account.openingBalanceMinor,
  balanceMinor: balanceMinor ?? account.openingBalanceMinor,
  status: account.status,
  isDefault: account.isDefault,
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
})

/** GET /api/spaces/:spaceId/accounts — accounts with derived balances. */
export const listAccounts = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const spaceId = req.space!._id

    const [accounts, balances] = await Promise.all([
      Account.find({ spaceId, deletedAt: null }).sort({ createdAt: 1 }),
      computeBalances(String(spaceId)),
    ])

    const payload = accounts.map((account) =>
      serializeAccount(
        account,
        balances.get(String(account._id))?.balanceMinor,
      ),
    )

    const totalsByCurrency: Record<string, number> = {}
    for (const account of payload) {
      totalsByCurrency[account.currency] =
        (totalsByCurrency[account.currency] ?? 0) + account.balanceMinor
    }

    return res.json({
      success: true,
      accounts: payload,
      totalsByCurrency,
    })
  } catch (error) {
    next(error)
  }
}

/** POST /api/spaces/:spaceId/accounts */
export const createAccount = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = createAccountSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid account data',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const spaceId = req.space!._id

    // The first account in a space, or one explicitly asked for, becomes the
    // default payment source (Product Spec §7).
    const existingCount = await Account.countDocuments({
      spaceId,
      deletedAt: null,
    })
    const makeDefault =
      result.data.isDefault === true || existingCount === 0

    if (makeDefault) {
      await Account.updateMany(
        { spaceId, isDefault: true },
        { $set: { isDefault: false } },
      )
    }

    const account = await Account.create({
      spaceId,
      name: result.data.name,
      type: result.data.type,
      currency: result.data.currency ?? 'PHP',
      openingBalanceMinor: result.data.openingBalanceMinor ?? 0,
      status: 'ACTIVE',
      isDefault: makeDefault,
      createdBy: req.user!.id,
    })

    return res.status(201).json({
      success: true,
      message: 'Account created',
      account: serializeAccount(account),
    })
  } catch (error) {
    next(error)
  }
}

/** GET /api/spaces/:spaceId/accounts/:accountId */
export const getAccount = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const account = await Account.findOne({
      _id: req.params.accountId,
      spaceId: req.space!._id,
      deletedAt: null,
    }).catch(() => null)

    if (!account) {
      return res
        .status(404)
        .json({ success: false, message: 'Account not found' })
    }

    const balances = await computeBalances(String(req.space!._id))

    return res.json({
      success: true,
      account: serializeAccount(
        account,
        balances.get(String(account._id))?.balanceMinor,
      ),
    })
  } catch (error) {
    next(error)
  }
}

/** PATCH /api/spaces/:spaceId/accounts/:accountId — name / type / status. */
export const updateAccount = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = updateAccountSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid account data',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const account = await Account.findOne({
      _id: req.params.accountId,
      spaceId: req.space!._id,
      deletedAt: null,
    }).catch(() => null)

    if (!account) {
      return res
        .status(404)
        .json({ success: false, message: 'Account not found' })
    }

    if (result.data.name !== undefined) account.name = result.data.name
    if (result.data.type !== undefined) account.type = result.data.type
    if (result.data.status !== undefined) {
      account.status = result.data.status
      // An archived account can't stay the default.
      if (result.data.status === 'ARCHIVED') account.isDefault = false
    }
    if (result.data.isDefault === true) {
      await Account.updateMany(
        { spaceId: req.space!._id, isDefault: true },
        { $set: { isDefault: false } },
      )
      account.isDefault = true
    }

    await account.save()

    return res.json({
      success: true,
      message: 'Account updated',
      account: serializeAccount(account),
    })
  } catch (error) {
    next(error)
  }
}

/**
 * DELETE /api/spaces/:spaceId/accounts/:accountId — soft delete.
 * Blocked while the account still has non-deleted transactions so balances and
 * history stay coherent; archive it instead.
 */
export const deleteAccount = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const account = await Account.findOne({
      _id: req.params.accountId,
      spaceId: req.space!._id,
      deletedAt: null,
    }).catch(() => null)

    if (!account) {
      return res
        .status(404)
        .json({ success: false, message: 'Account not found' })
    }

    const referencing = await Transaction.countDocuments({
      spaceId: req.space!._id,
      deletedAt: null,
      $or: [
        { accountId: account._id },
        { destinationAccountId: account._id },
      ],
    })

    if (referencing > 0) {
      return res.status(409).json({
        success: false,
        message:
          'This account still has transactions. Archive it instead of deleting.',
      })
    }

    account.deletedAt = new Date()
    await account.save()

    return res.json({ success: true, message: 'Account deleted' })
  } catch (error) {
    next(error)
  }
}
