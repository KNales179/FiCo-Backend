import User from '../models/User.js'
import { sendPushToUser } from './push.js'

const lastAlertAt = new Map<string, number>()
const ALERT_COOLDOWN_MS = 5 * 60 * 1000

/**
 * "Something broke" — a push notification to every admin's device,
 * reusing the same push channel feedback reports already use rather than
 * standing up a separate (often paid) monitoring/alerting service. Always
 * logs to the console too, so it shows up in whatever the hosting
 * platform's own log viewer is even if push isn't configured.
 *
 * Never throws — an alert failing to send must never mask, replace, or
 * interrupt handling of the original problem — and is throttled per
 * `signature` (e.g. an error's name, or a fixed string for "the whole
 * process crashed") so a repeating failure sends one notification per
 * cooldown window instead of flooding every admin device once per
 * occurrence.
 */
export const alertAdmins = (
  signature: string,
  title: string,
  detail: string,
): void => {
  console.error(`[ALERT] ${title}: ${detail}`)

  const now = Date.now()
  const last = lastAlertAt.get(signature)
  if (last && now - last < ALERT_COOLDOWN_MS) return
  lastAlertAt.set(signature, now)

  void (async () => {
    try {
      const admins = await User.find({ role: 'ADMIN', status: 'ACTIVE' }).select(
        '_id',
      )
      await Promise.all(
        admins.map((admin) =>
          sendPushToUser(admin._id, {
            title,
            body: detail.slice(0, 180),
            tag: 'fico-alert',
          }).catch(() => {
            // One admin's push failing must never stop the others.
          }),
        ),
      )
    } catch {
      // Best-effort only — a DB hiccup here must not compound whatever
      // already went wrong.
    }
  })()
}
