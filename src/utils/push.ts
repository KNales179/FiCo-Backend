import webpush from 'web-push'
import mongoose from 'mongoose'
import PushSubscription from '../models/PushSubscription.js'

let configured = false

const configure = (): boolean => {
  if (configured) return true
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return false

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@localhost',
    publicKey,
    privateKey,
  )
  configured = true
  return true
}

/** Whether push is usable at all — lets a route/job degrade quietly instead of throwing. */
export const isPushConfigured = (): boolean => configure()

export const getVapidPublicKey = (): string | null =>
  isPushConfigured() ? (process.env.VAPID_PUBLIC_KEY as string) : null

export interface PushPayload {
  title: string
  body: string
  tag?: string
  url?: string
}

/**
 * Sends to every device this user is subscribed on. A subscription the
 * browser has since dropped (410 Gone / 404) is removed rather than
 * retried forever; anything else is logged and otherwise ignored — one
 * bad subscription shouldn't stop the rest of this user's devices, or the
 * caller's loop over other users.
 */
export const sendPushToUser = async (
  userId: mongoose.Types.ObjectId | string,
  payload: PushPayload,
): Promise<void> => {
  if (!isPushConfigured()) return

  const subscriptions = await PushSubscription.find({ userId })

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload),
        )
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          await sub.deleteOne()
        } else {
          console.error('Push send failed:', error)
        }
      }
    }),
  )
}
