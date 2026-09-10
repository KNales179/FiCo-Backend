import { Router } from 'express'
import { requireSpaceMember } from '../middleware/spaceAccess.js'
import { syncRateLimiter } from '../middleware/rateLimiter.js'
import { pullSync, pushSync } from '../controllers/syncController.js'

const router = Router({ mergeParams: true })

router.use(syncRateLimiter)

// Any active member may sync; per-record visibility is enforced inside.
router.post('/push', requireSpaceMember('EDITOR'), pushSync)
router.get('/pull', requireSpaceMember('VIEWER'), pullSync)

export default router
