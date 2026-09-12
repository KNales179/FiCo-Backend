import { Response, NextFunction } from 'express'
import PushSubscription from '../models/PushSubscription.js'
import { getVapidPublicKey } from '../utils/push.js'
import { subscribePushSchema, unsubscribePushSchema } from '../validation/pushValidation.js'
import { AuthRequest } from '../middleware/authMiddleware.js'

export const getPublicKey = (req: AuthRequest, res: Response) => {
  return res.json({ success: true, publicKey: getVapidPublicKey() })
}

export const subscribe = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = subscribePushSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({ success: false, message: 'Invalid subscription' })
    }

    const { endpoint, keys, deviceId } = result.data

    // Re-subscribing on the same device (permission re-granted, browser
    // rotated the endpoint, etc.) replaces whatever was there for that
    // endpoint rather than piling up duplicates.
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      { userId: req.user?.id, deviceId, keys },
      { upsert: true, new: true },
    )

    return res.json({ success: true, message: 'Subscribed' })
  } catch (error) {
    next(error)
  }
}

export const unsubscribe = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = unsubscribePushSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({ success: false, message: 'Invalid request' })
    }

    await PushSubscription.deleteOne({
      endpoint: result.data.endpoint,
      userId: req.user?.id,
    })

    return res.json({ success: true, message: 'Unsubscribed' })
  } catch (error) {
    next(error)
  }
}
