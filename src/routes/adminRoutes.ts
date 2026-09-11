import { Router } from 'express'
import {
  listUsers,
  setUserPassword,
  setUserRole,
  listUserSessions,
  revokeUserSession,
} from '../controllers/adminController.js'
import { authenticate, requireAdmin } from '../middleware/authMiddleware.js'

const router = Router()

router.use(authenticate, requireAdmin)

router.get('/users', listUsers)
router.post('/users/:userId/password', setUserPassword)
router.post('/users/:userId/role', setUserRole)
router.get('/users/:userId/sessions', listUserSessions)
router.post('/users/:userId/sessions/:sessionId/revoke', revokeUserSession)

export default router
