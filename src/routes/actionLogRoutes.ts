import { Router } from 'express'
import { requireSpaceMember } from '../middleware/spaceAccess.js'
import { listActionLogs } from '../controllers/actionLogController.js'

const router = Router({ mergeParams: true })

// Read-only. There is deliberately no write route (Architecture §26, §40).
// Who changed what — owners and admins only.
router.get('/', requireSpaceMember('ADMIN'), listActionLogs)

export default router
