import { Router } from 'express'
import {
  listUsers,
  setUserPassword,
  setUserRole,
  listUserSessions,
  revokeUserSession,
  resetUserTwoFactor,
} from '../controllers/adminController.js'
import {
  getUserProfile,
  sendNotice,
  signOutUser,
  restrictUser,
  unrestrictUser,
  deleteUser,
} from '../controllers/adminUserController.js'
import { authenticate, requireAdmin } from '../middleware/authMiddleware.js'
import { adminActionRateLimiter } from '../middleware/rateLimiter.js'

const router = Router()

router.use(authenticate, requireAdmin)

router.get('/users', listUsers)
router.get('/users/:userId', getUserProfile)
router.post('/users/:userId/notice', adminActionRateLimiter, sendNotice)
router.post('/users/:userId/sign-out', adminActionRateLimiter, signOutUser)
router.post('/users/:userId/restrict', adminActionRateLimiter, restrictUser)
router.post('/users/:userId/unrestrict', adminActionRateLimiter, unrestrictUser)
router.delete('/users/:userId', adminActionRateLimiter, deleteUser)
router.post('/users/:userId/password', adminActionRateLimiter, setUserPassword)
router.post('/users/:userId/role', adminActionRateLimiter, setUserRole)
router.post('/users/:userId/2fa/reset', adminActionRateLimiter, resetUserTwoFactor)
router.get('/users/:userId/sessions', listUserSessions)
router.post(
  '/users/:userId/sessions/:sessionId/revoke',
  adminActionRateLimiter,
  revokeUserSession,
)

export default router
