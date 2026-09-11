import { Router } from 'express'
import { requireSpaceMember } from '../middleware/spaceAccess.js'
import { listActionLogs } from '../controllers/actionLogController.js'

const router = Router({ mergeParams: true })

// Read-only. There is deliberately no write route (Architecture §26, §40).
router.get('/', requireSpaceMember('MEMBER'), listActionLogs)

export default router
