import { Response, NextFunction } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import Notification from '../models/Notification.js'
import { AuthRequest } from '../middleware/authMiddleware.js'

const toDto = (n: InstanceType<typeof Notification>) => ({
  id: n.id,
  kind: n.kind,
  title: n.title,
  body: n.body,
  link: n.link ?? null,
  senderName: n.senderName ?? null,
  popup: n.popup,
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
})

/** Your own notifications, newest first (the latest 100). */
export const listNotifications = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [items, unread] = await Promise.all([
      Notification.find({ userId: req.user!.id }).sort({ createdAt: -1 }).limit(100),
      Notification.countDocuments({ userId: req.user!.id, readAt: null }),
    ])
    return res.json({ success: true, notifications: items.map(toDto), unread })
  } catch (error) {
    next(error)
  }
}

const markSchema = z.object({
  ids: z.array(z.string().refine((id) => mongoose.isValidObjectId(id))).max(200).optional(),
  all: z.boolean().optional(),
})

/** Mark some (or all) of your notifications read. */
export const markNotificationsRead = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = markSchema.safeParse(req.body ?? {})
    if (!result.success || (!result.data.all && !result.data.ids?.length)) {
      return res.status(400).json({ success: false, message: 'Nothing to mark' })
    }
    const filter: Record<string, unknown> = { userId: req.user!.id, readAt: null }
    if (!result.data.all) filter._id = { $in: result.data.ids }
    await Notification.updateMany(filter, { $set: { readAt: new Date() } })
    const unread = await Notification.countDocuments({ userId: req.user!.id, readAt: null })
    return res.json({ success: true, unread })
  } catch (error) {
    next(error)
  }
}
