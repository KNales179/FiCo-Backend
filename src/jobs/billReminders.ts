import SyncRecord from '../models/SyncRecord.js'
import Membership from '../models/Membership.js'
import BillNotificationLog from '../models/BillNotificationLog.js'
import { isPushConfigured, sendPushToUser } from '../utils/push.js'

/** Matches the frontend's own `DUE_SOON_DAYS` (domain/bills.ts) — same
 *  window as the in-app banner, so a push never fires for something the
 *  in-app reminder wouldn't also be flagging. */
const DUE_SOON_DAYS = 3

interface BillPayload {
  id?: string
  name?: string
  active?: boolean
  nextDueDate?: string
}

/**
 * One pass: every active bill across every space whose due date is
 * overdue-or-within-`DUE_SOON_DAYS`, that hasn't already had a push sent
 * for this specific occurrence, gets one — to every active member of its
 * space (a shared Finance's bill is everyone's concern, same as
 * everywhere else in this app). `BillNotificationLog` is what keeps a
 * bill sitting in that window across many ticks from re-notifying; a
 * payment (or any other change to `nextDueDate`) is a new occurrence and
 * gets its own reminder.
 */
export const runBillReminderCheck = async (): Promise<void> => {
  if (!isPushConfigured()) return

  const now = new Date()
  const threshold = new Date(
    now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000,
  )

  const bills = await SyncRecord.find({
    entityType: 'bill',
    deletedAt: null,
  })

  for (const record of bills) {
    const payload = record.payload as BillPayload
    if (!payload.active || !payload.nextDueDate || !payload.id) continue

    const dueDate = new Date(payload.nextDueDate)
    if (Number.isNaN(dueDate.getTime()) || dueDate > threshold) continue

    const already = await BillNotificationLog.findOne({
      billId: payload.id,
      dueDateNotified: payload.nextDueDate,
    })
    if (already) continue

    const overdue = dueDate < now
    const members = await Membership.find({
      spaceId: record.spaceId,
      status: 'ACTIVE',
    })

    await Promise.all(
      members.map((member) =>
        sendPushToUser(member.userId, {
          title: overdue ? 'Bill overdue' : 'Bill due soon',
          body: `${payload.name ?? 'A bill'} — ${dueDate.toLocaleDateString()}`,
          tag: `bill-${payload.id}`,
          url: '/bills',
        }),
      ),
    )

    // Recorded even if there were zero members to notify (an empty/solo
    // space) — this occurrence has been handled either way.
    await BillNotificationLog.create({
      billId: payload.id,
      dueDateNotified: payload.nextDueDate,
      notifiedAt: new Date(),
    })
  }
}

/** Runs once immediately, then on a fixed interval — a simple in-process
 *  scheduler, appropriate for this app's single-server scale. */
export const startBillReminderJob = (
  intervalMs: number = 60 * 60 * 1000,
): NodeJS.Timeout => {
  void runBillReminderCheck().catch((error) =>
    console.error('Bill reminder check failed:', error),
  )
  return setInterval(() => {
    void runBillReminderCheck().catch((error) =>
      console.error('Bill reminder check failed:', error),
    )
  }, intervalMs)
}
