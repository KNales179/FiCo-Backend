import { Router } from 'express'
import { requireSpaceMember } from '../middleware/spaceAccess.js'
import {
  createReconciliation,
  listReconciliations,
  resolveReconciliation,
} from '../controllers/reconciliationController.js'

const router = Router({ mergeParams: true })

router.get('/', requireSpaceMember('MEMBER'), listReconciliations)
router.post('/', requireSpaceMember('MEMBER'), createReconciliation)
router.patch(
  '/:id',
  requireSpaceMember('MEMBER'),
  resolveReconciliation,
)

export default router
