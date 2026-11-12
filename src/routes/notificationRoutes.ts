import { Router } from 'express'
import { listNotifications, markNotificationsRead } from '../controllers/notificationController.js'
import { authenticate } from '../middleware/authMiddleware.js'

const router = Router()

router.use(authenticate)
router.get('/', listNotifications)
router.post('/read', markNotificationsRead)

export default router
