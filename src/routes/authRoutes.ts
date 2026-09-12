import { NextFunction, Request, Response, Router } from 'express'
import { MulterError } from 'multer'
import { MAX_AVATAR_BYTES, uploadAvatar as uploadAvatarMiddleware } from '../middleware/upload.js'
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
  updateNotificationPreferences,
  uploadMyAvatar,
  deleteMyAvatar,
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

router.patch(
  '/notification-preferences',
  authenticate,
  updateNotificationPreferences,
)

/** Turns multer's errors into clean 400/413 responses, same as attachments. */
const handleAvatarUpload = (req: Request, res: Response, next: NextFunction) => {
  uploadAvatarMiddleware.single('file')(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `Image is larger than ${MAX_AVATAR_BYTES / (1024 * 1024)} MB`
          : 'Upload failed'
      return res.status(413).json({ success: false, message })
    }
    if (err instanceof Error) {
      if (err.message === 'UNSUPPORTED_FILE_TYPE') {
        return res.status(415).json({
          success: false,
          message: 'Only JPEG, PNG, or WebP images are allowed',
        })
      }
      return next(err)
    }
    next()
  })
}

router.post(
  '/me/avatar',
  authenticate,
  handleAvatarUpload,
  uploadMyAvatar,
)

router.delete(
  '/me/avatar',
  authenticate,
  deleteMyAvatar,
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
