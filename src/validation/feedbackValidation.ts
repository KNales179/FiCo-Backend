import { z } from 'zod'

export const createFeedbackSchema = z.object({
  type: z.enum(['BUG', 'SUGGESTION']),
  message: z
    .string()
    .trim()
    .min(1, 'Say what happened, or what you have in mind')
    .max(2000, 'Keep it under 2000 characters'),
  // Where in the app it's about — both optional.
  page: z.string().trim().max(60).optional(),
  section: z.string().trim().max(80).optional(),
})

export const feedbackStatusSchema = z.object({
  status: z.enum(['OPEN', 'RESOLVED']),
})
