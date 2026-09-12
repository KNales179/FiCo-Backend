import { Router } from 'express'
import { getPublicKey, subscribe, unsubscribe } from '../controllers/pushController.js'
import { authenticate } from '../middleware/authMiddleware.js'

const router = Router()

router.use(authenticate)

router.get('/vapid-public-key', getPublicKey)
router.post('/subscribe', subscribe)
router.post('/unsubscribe', unsubscribe)

export default router
