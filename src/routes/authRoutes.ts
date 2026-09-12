import { Router } from 'express'
import {
  register,
  login,
  verifyTwoFactorLogin,
  logout,
  getMe,
  updateMe,
  deleteMe,
  changePassword,
  listMySessions,
  revokeMySession,
  resendVerificationEmail,
  verifyEmail,
  forgotPassword,
  resetPassword,
} from '../controllers/authController.js'
import {
  startTwoFactorSetup,
  confirmTwoFactorSetup,
  disableTwoFactor,
} from '../controllers/twoFactorController.js'
import { authenticate } from '../middleware/authMiddleware.js'
import {
  accountSecurityRateLimiter,
  emailSendRateLimiter,
  loginRateLimiter,
  registerRateLimiter,
  twoFactorRateLimiter,
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
  '/login/verify-2fa',
  twoFactorRateLimiter,
  verifyTwoFactorLogin,
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

router.post(
  '/change-password',
  authenticate,
  accountSecurityRateLimiter,
  changePassword,
)

router.get(
  '/sessions',
  authenticate,
  listMySessions,
)

router.post(
  '/sessions/:sessionId/revoke',
  authenticate,
  revokeMySession,
)

router.post(
  '/2fa/setup',
  authenticate,
  twoFactorRateLimiter,
  startTwoFactorSetup,
)

router.post(
  '/2fa/confirm',
  authenticate,
  twoFactorRateLimiter,
  confirmTwoFactorSetup,
)

router.post(
  '/2fa/disable',
  authenticate,
  twoFactorRateLimiter,
  disableTwoFactor,
)

router.post(
  '/verify-email/resend',
  authenticate,
  emailSendRateLimiter,
  resendVerificationEmail,
)

router.post(
  '/verify-email',
  twoFactorRateLimiter,
  verifyEmail,
)

router.post(
  '/forgot-password',
  emailSendRateLimiter,
  forgotPassword,
)

router.post(
  '/reset-password',
  twoFactorRateLimiter,
  resetPassword,
)

export default router
