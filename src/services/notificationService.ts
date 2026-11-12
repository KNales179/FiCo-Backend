import mongoose from 'mongoose'
import Notification, { NotificationKind } from '../models/Notification.js'
import Session from '../models/Session.js'
import { sendPushToUser } from '../utils/push.js'

/**
 * Saves a notification for one person and, best effort, pushes it to their
 * devices too. A failure here never breaks the action that triggered it.
 */
export const notifyUser = async (params: {
  userId: mongoose.Types.ObjectId | string
  kind: NotificationKind
  title: string
  body: string
  link?: string | null
  senderName?: string | null
  senderId?: mongoose.Types.ObjectId | string | null
  popup?: boolean
  push?: boolean
}): Promise<void> => {
  try {
    await Notification.create({
      userId: params.userId,
      kind: params.kind,
      title: params.title.slice(0, 120),
      body: params.body.slice(0, 2000),
      link: params.link ?? null,
      senderName: params.senderName ?? null,
      senderId: params.senderId ?? null,
      popup: params.popup ?? false,
    })
    if (params.push !== false) {
      await sendPushToUser(params.userId, {
        title: params.title,
        body: params.body.slice(0, 180),
        url: params.link || '/notifications',
      }).catch(() => undefined)
    }
  } catch (error) {
    console.error('notifyUser failed:', error)
  }
}

export type SignOutCode =
  | 'ADMIN_SIGN_OUT'
  | 'ACCOUNT_RESTRICTED'
  | 'ACCOUNT_DELETED'
  | 'ADMIN_PASSWORD_RESET'
  | 'ADMIN_2FA_RESET'

/**
 * Signs every device of an account out, leaving a note on each session so
 * the next request from that device can tell the person *why* (shown as a
 * pop-up on the sign-in screen) instead of a bare "session expired".
 */
export const signOutEverywhere = async (
  userId: mongoose.Types.ObjectId | string,
  notice: { code: SignOutCode; reason?: string | null; until?: Date | null },
): Promise<number> => {
  const now = new Date()
  const result = await Session.updateMany(
    { userId, revokedAt: null },
    {
      $set: {
        revokedAt: now,
        revokedNotice: {
          code: notice.code,
          reason: notice.reason?.slice(0, 500) || null,
          until: notice.until ?? null,
          at: now,
        },
      },
    },
  )
  return result.modifiedCount
}
