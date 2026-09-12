import 'dotenv/config'
import app from './app.js'
import connectDB from './config/db.js'
import { startBillReminderJob } from './jobs/billReminders.js'

const PORT = process.env.PORT || 5000

const startServer = async () => {
  await connectDB()

  app.listen(PORT, () => {
    console.log(`Fico API running on port ${PORT}`)
  })

  // No-op (logs once, does nothing further) until VAPID_PUBLIC_KEY /
  // VAPID_PRIVATE_KEY are actually set.
  startBillReminderJob()
}

startServer()
