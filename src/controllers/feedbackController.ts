import { Response, NextFunction } from 'express'
import Feedback from '../models/Feedback.js'
import User from '../models/User.js'
import { sendPushToUserIfEnabled } from '../utils/push.js'
import {
  createFeedbackSchema,
  feedbackStatusSchema,
} from '../validation/feedbackValidation.js'
import { AuthRequest } from '../middleware/authMiddleware.js'

/** Anyone signed in — a bug report or a suggestion, not tied to one Finance. */
export const createFeedback = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = createFeedbackSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const feedback = await Feedback.create({
      userId: req.user!.id,
      type: result.data.type,
      message: result.data.message,
    })

    // Best effort — a stalled/misconfigured push setup must never block the
    // report itself from being saved.
    void User.find({ role: 'ADMIN' })
      .then((admins) =>
        Promise.all(
          admins.map((admin) =>
            sendPushToUserIfEnabled(admin.id, 'feedbackReports', {
              title:
                result.data.type === 'BUG' ? 'New bug report' : 'New suggestion',
              body: `${req.user!.username}: ${result.data.message.slice(0, 120)}`,
              tag: `feedback-${feedback.id}`,
              url: '/admin/feedback',
            }),
          ),
        ),
      )
      .catch((error) => {
        console.error('[fico/api] Could not notify admins of new feedback:', error)
      })

    return res.status(201).json({
      success: true,
      message:
        result.data.type === 'BUG'
          ? 'Thanks — the report is in.'
          : 'Thanks for the suggestion.',
    })
  } catch (error) {
    next(error)
  }
}

/** Admin only — every report/suggestion, newest first. */
export const listFeedback = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const rows = await Feedback.find()
      .sort({ createdAt: -1 })
      .populate<{ userId: { _id: unknown; username: string; displayName?: string | null } }>(
        'userId',
        'username displayName',
      )

    return res.json({
      success: true,
      feedback: rows.map((row) => ({
        id: row.id,
        type: row.type,
        message: row.message,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        reporter: {
          username: row.userId?.username ?? 'Unknown',
          displayName: row.userId?.displayName ?? null,
        },
      })),
    })
  } catch (error) {
    next(error)
  }
}

/** Admin only — mark a report reviewed, or reopen it. */
export const setFeedbackStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = feedbackStatusSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({ success: false, message: 'Invalid request' })
    }

    const feedback = await Feedback.findById(req.params.feedbackId)
    if (!feedback) {
      return res.status(404).json({ success: false, message: 'Not found' })
    }

    feedback.status = result.data.status
    await feedback.save()

    return res.json({ success: true, message: 'Updated' })
  } catch (error) {
    next(error)
  }
}
