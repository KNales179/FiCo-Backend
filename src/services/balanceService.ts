import mongoose from 'mongoose'
import Account from '../models/Account.js'
import Transaction from '../models/Transaction.js'

export interface AccountBalance {
  accountId: string
  openingBalanceMinor: number
  balanceMinor: number
}

/**
 * Derives every account's current balance in a space from its opening balance
 * plus the effect of each non-deleted transaction:
 *
 *   INCOME    → + amount on the account
 *   EXPENSE   → − amount on the account
 *   TRANSFER  → − amount on the source, + amount on the destination
 *
 * A TRANSFER never changes the space's total money and is never counted as an
 * expense (Architecture Rule 4).
 */
export const computeBalances = async (
  spaceId: string | mongoose.Types.ObjectId,
): Promise<Map<string, AccountBalance>> => {
  const accounts = await Account.find({
    spaceId,
    deletedAt: null,
  }).lean()

  const balances = new Map<string, AccountBalance>(
    accounts.map((account) => [
      String(account._id),
      {
        accountId: String(account._id),
        openingBalanceMinor: account.openingBalanceMinor,
        balanceMinor: account.openingBalanceMinor,
      },
    ]),
  )

  const apply = (accountId: string, delta: number) => {
    const entry = balances.get(accountId)
    if (entry) {
      entry.balanceMinor += delta
    }
  }

  const transactions = await Transaction.find({
    spaceId,
    deletedAt: null,
  })
    .select('type amountMinor accountId destinationAccountId')
    .lean()

  for (const txn of transactions) {
    const source = String(txn.accountId)

    if (txn.type === 'INCOME') {
      apply(source, txn.amountMinor)
    } else if (txn.type === 'EXPENSE') {
      apply(source, -txn.amountMinor)
    } else if (txn.type === 'TRANSFER') {
      apply(source, -txn.amountMinor)
      if (txn.destinationAccountId) {
        apply(String(txn.destinationAccountId), txn.amountMinor)
      }
    }
  }

  return balances
}
