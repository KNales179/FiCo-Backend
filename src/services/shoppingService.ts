import { IShoppingItem } from '../models/ShoppingItem.js'
import { IShoppingList } from '../models/ShoppingList.js'

export interface ListTotals {
  itemCount: number
  checkedCount: number
  /** Sum of actual prices where entered, otherwise planned prices. */
  projectedTotalMinor: number
  /** Sum of actual prices on checked items — money considered spent. */
  spentMinor: number
  /** plannedBudget − spent, or null when no budget was set. */
  remainingBudgetMinor: number | null
}

/**
 * Item prices (`plannedPriceMinor`, `actualPriceMinor`) are line totals — the
 * amount for that item as a whole, matching the Product Spec examples.
 * `quantity` is descriptive.
 */
export const computeListTotals = (
  list: Pick<IShoppingList, 'plannedBudgetMinor'>,
  items: Array<
    Pick<
      IShoppingItem,
      'plannedPriceMinor' | 'actualPriceMinor' | 'checked'
    >
  >,
): ListTotals => {
  let projectedTotalMinor = 0
  let spentMinor = 0
  let checkedCount = 0

  for (const item of items) {
    const planned = item.plannedPriceMinor ?? 0
    const actual = item.actualPriceMinor

    projectedTotalMinor += actual ?? planned

    if (item.checked) {
      checkedCount += 1
      spentMinor += actual ?? planned
    }
  }

  const remainingBudgetMinor =
    list.plannedBudgetMinor != null
      ? list.plannedBudgetMinor - spentMinor
      : null

  return {
    itemCount: items.length,
    checkedCount,
    projectedTotalMinor,
    spentMinor,
    remainingBudgetMinor,
  }
}
