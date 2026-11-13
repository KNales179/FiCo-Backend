import { Response, NextFunction } from 'express'
import Feedback from '../models/Feedback.js'
import User from '../models/User.js'
import { sendPushToUserIfEnabled } from '../utils/push.js'
import {
  createFeedbackSchema,
  feedbackStatusSchema,
} from '../validation/feedbackValidation.js'
import { notifyUser } from '../services/notificationService.js'
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
      page: result.data.page || null,
      section: result.data.page && result.data.section ? result.data.section : null,
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
              body: `${req.user!.username}${result.data.page ? ` · ${result.data.page}${result.data.section ? ` › ${result.data.section}` : ''}` : ''}: ${result.data.message.slice(0, 120)}`,
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
        page: row.page ?? null,
        section: row.section ?? null,
        createdAt: row.createdAt.toISOString(),
        // So the admin's own submitted feedback never lights up their own
        // "new suggestion" nav badge — see features/seen's isUnseen.
        createdBy: row.userId?._id ? String(row.userId._id) : null,
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
    const tellSender = feedback.status === 'RESOLVED' && !feedback.notifiedAt
    if (tellSender) feedback.notifiedAt = new Date()
    await feedback.save()

    // Let whoever sent it know it's done, pointing them at Updates.
    if (tellSender) {
      const excerpt = feedback.message.length > 90 ? `${feedback.message.slice(0, 90).trim()}…` : feedback.message
      const suggestion = feedback.type === 'SUGGESTION'
      await notifyUser({
        userId: feedback.userId,
        kind: 'FEEDBACK_DONE',
        title: suggestion ? 'Your suggestion made it into Fico!' : 'The bug you reported is fixed',
        body: suggestion
          ? `“${excerpt}” — the Fico team marked your suggestion as done. Thank you! Go check Updates to see what’s new.`
          : `“${excerpt}” — the Fico team marked this as fixed. Thanks for reporting it! Check Updates for the details.`,
        link: '/updates',
        senderName: 'Fico Admin Team',
        senderId: req.user?.id ?? null,
      })
    }

    return res.json({ success: true, message: 'Updated' })
  } catch (error) {
    next(error)
  }
}
