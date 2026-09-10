import { Router } from 'express'
import { requireSpaceMember } from '../middleware/spaceAccess.js'
import {
  createReconciliation,
  listReconciliations,
  resolveReconciliation,
} from '../controllers/reconciliationController.js'

const router = Router({ mergeParams: true })

router.get('/', requireSpaceMember('VIEWER'), listReconciliations)
router.post('/', requireSpaceMember('EDITOR'), createReconciliation)
router.patch(
  '/:id',
  requireSpaceMember('EDITOR'),
  resolveReconciliation,
)

export default router
