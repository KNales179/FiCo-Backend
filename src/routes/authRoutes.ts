import { Router } from 'express'
import {
  register,
  login,
  logout,
  getMe,
  updateMe,
  deleteMe,
} from '../controllers/authController.js'
import { authenticate } from '../middleware/authMiddleware.js'
import { loginRateLimiter, registerRateLimiter } from '../middleware/rateLimiter.js'

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

export default router