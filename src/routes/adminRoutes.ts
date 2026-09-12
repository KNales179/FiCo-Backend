import { Router } from 'express'
import {
  listUsers,
  setUserPassword,
  setUserRole,
  listUserSessions,
  revokeUserSession,
} from '../controllers/adminController.js'
import { authenticate, requireAdmin } from '../middleware/authMiddleware.js'
import { adminActionRateLimiter } from '../middleware/rateLimiter.js'

const router = Router()

router.use(authenticate, requireAdmin)

router.get('/users', listUsers)
router.post('/users/:userId/password', adminActionRateLimiter, setUserPassword)
router.post('/users/:userId/role', adminActionRateLimiter, setUserRole)
router.get('/users/:userId/sessions', listUserSessions)
router.post(
  '/users/:userId/sessions/:sessionId/revoke',
  adminActionRateLimiter,
  revokeUserSession,
)

export default router
