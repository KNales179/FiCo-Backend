/**
 * Record-level privacy within a space (Product Spec §22).
 *
 * A record's `visibility` is `SPACE` (every member sees it) or `PRIVATE` (only
 * its creator). Being a space member does not by itself grant sight of every
 * record.
 *
 * Note on balances: a PRIVATE transaction is hidden from other members' lists
 * and from shared analytics, but it still moves the account balance — the money
 * genuinely left the account. Privacy hides the line item, not the arithmetic.
 */
export const visibilityFilter = (userId: string) => ({
  $or: [{ visibility: { $ne: 'PRIVATE' } }, { createdBy: userId }],
})
