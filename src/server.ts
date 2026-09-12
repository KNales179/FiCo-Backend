import 'dotenv/config'
import app from './app.js'
import connectDB from './config/db.js'
import { startBillReminderJob } from './jobs/billReminders.js'
import { alertAdmins } from './utils/alerting.js'

const PORT = process.env.PORT || 5000

/**
 * A truly uncaught exception or unhandled promise rejection means
 * something escaped every try/catch and Express's own error handling —
 * there was no earlier chance to alert on it. Node's process is left in
 * an unknown state after an uncaught exception, so the safe move is to
 * alert, then exit and let whatever's supervising the process (a process
 * manager, a container restart policy) bring it back up — not keep
 * serving requests from a process that might be half-broken.
 */
process.on('uncaughtException', (error) => {
  alertAdmins(
    'uncaughtException',
    'Fico: server crashed',
    error?.stack || String(error),
  )
  // Give the alert's fire-and-forget push a moment to actually go out
  // before the process exits.
  setTimeout(() => process.exit(1), 2000)
})

process.on('unhandledRejection', (reason) => {
  alertAdmins(
    'unhandledRejection',
    'Fico: unhandled promise rejection',
    reason instanceof Error ? reason.stack || reason.message : String(reason),
  )
})

/**
 * Fail loudly at boot rather than quietly running with a weaker security
 * posture. `hashSessionId` (utils/session.ts) falls back to an *unkeyed*
 * hash when `SESSION_SECRET` is unset — a reasonable default for local
 * development (nobody wants a mandatory secret just to run `npm run dev`),
 * but never something a real deployment should silently do.
 */
const assertRequiredEnv = (): void => {
  if (process.env.NODE_ENV !== 'production') return
  const missing = ['SESSION_SECRET'].filter((key) => !process.env[key])
  if (missing.length > 0) {
    console.error(
      `[fico/api] Refusing to start in production without: ${missing.join(', ')}`,
    )
    process.exit(1)
  }
}

const startServer = async () => {
  assertRequiredEnv()
  await connectDB()

  app.listen(PORT, () => {
    console.log(`Fico API running on port ${PORT}`)
  })

  // No-op (logs once, does nothing further) until VAPID_PUBLIC_KEY /
  // VAPID_PRIVATE_KEY are actually set.
  startBillReminderJob()
}

startServer()
