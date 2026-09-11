import { Router } from 'express'
import {
  register,
  login,
  logout,
  getMe,
  updateMe,
  deleteMe,
  devResetPassword,
} from '../controllers/authController.js'
import { authenticate } from '../middleware/authMiddleware.js'
import {
  loginRateLimiter,
  registerRateLimiter,
  devResetPasswordRateLimiter,
} from '../middleware/rateLimiter.js'

const router = Router() 

router.post(
  '/register',
  registerRateLimiter,
  register,
)

router.post(
  '/login',
  loginRateLimiter,
  login,
)

router.post(
  '/logout',
  authenticate,
  logout,
)

router.get(
  '/me',
  authenticate,
  getMe,
)

router.patch(
  '/me',
  authenticate,
  updateMe,
)

router.delete(
  '/me',
  authenticate,
  deleteMe,
)

// TEMPORARY — remove this route once real password reset ships. Refuses to
// run outside development inside the controller itself, as a second guard.
router.post(
  '/dev-reset-password',
  devResetPasswordRateLimiter,
  devResetPassword,
)

export default router