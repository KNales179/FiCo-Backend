import { Router } from 'express'
import {
  createFeedback,
  listFeedback,
  setFeedbackStatus,
} from '../controllers/feedbackController.js'
import { authenticate, requireAdmin } from '../middleware/authMiddleware.js'
import { feedbackRateLimiter } from '../middleware/rateLimiter.js'

const router = Router()

router.use(authenticate)

router.post('/', feedbackRateLimiter, createFeedback)
router.get('/', requireAdmin, listFeedback)
router.patch('/:feedbackId', requireAdmin, setFeedbackStatus)

export default router
