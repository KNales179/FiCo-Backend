import 'dotenv/config'
import app from './app.js'
import connectDB from './config/db.js'
import { startBillReminderJob } from './jobs/billReminders.js'

const PORT = process.env.PORT || 5000

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
