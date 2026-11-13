/**
 * Size limits for synced records — the single source of truth. The sync
 * validation schemas are built from these, and the app downloads them
 * (GET /api/sync/limits) so it trims text to exactly what this server
 * accepts. Change a limit here and both sides follow.
 */
export const SYNC_TEXT_LIMITS = {
  account: { name: 60 },
  transaction: { title: 120, categoryName: 60 },
  category: { name: 40 },
  shoppingList: { title: 120 },
  shoppingItem: { name: 120 },
  itemProfile: { displayName: 120 },
  priceHistory: { name: 120, categoryName: 80 },
  bill: { name: 80 },
  reconciliation: { note: 500, resolvedNote: 500 },
} as const

/** Budget plan lists (planned items, weekly staples, included bills). */
export const SYNC_LIST_LIMIT = 50
export const SYNC_LIST_ITEM_NAME = 80

export const syncLimitsDto = () => ({
  text: SYNC_TEXT_LIMITS,
  listLimit: SYNC_LIST_LIMIT,
  listItemName: SYNC_LIST_ITEM_NAME,
})
