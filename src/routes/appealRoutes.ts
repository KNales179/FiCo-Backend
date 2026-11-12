import { Router } from 'express'
import { createAppeal } from '../controllers/appealController.js'
import { loginRateLimiter } from '../middleware/rateLimiter.js'

const router = Router()

// No session here — a restricted person can't sign in. The appeal token
// from their (correct-password) sign-in attempt is the proof it's them.
router.post('/', loginRateLimiter, createAppeal)

export default router
