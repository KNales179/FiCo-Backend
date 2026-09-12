import { z } from 'zod'

export const subscribePushSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  deviceId: z.string().trim().min(1).max(100).optional(),
})

export const unsubscribePushSchema = z.object({
  endpoint: z.string().url(),
})
