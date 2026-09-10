export type Recurrence = 'MONTHLY' | 'YEARLY'

/** The next due date after `date`, keeping the day-of-month (clamped for short months). */
export const advanceDueDate = (
  date: Date,
  recurrence: Recurrence,
): Date => {
  const next = new Date(date)

  if (recurrence === 'YEARLY') {
    next.setUTCFullYear(next.getUTCFullYear() + 1)
    return next
  }

  const day = next.getUTCDate()
  next.setUTCDate(1)
  next.setUTCMonth(next.getUTCMonth() + 1)
  const lastDay = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate()
  next.setUTCDate(Math.min(day, lastDay))
  return next
}

/** A stable key for the occurrence a date belongs to — used to dedupe payments. */
export const periodKey = (
  date: Date,
  recurrence: Recurrence,
): string => {
  const year = date.getUTCFullYear()
  if (recurrence === 'YEARLY') return String(year)
  return `${year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}
