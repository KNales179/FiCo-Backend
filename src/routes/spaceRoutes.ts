import { Router } from 'express'
import { authenticate } from '../middleware/authMiddleware.js'
import { requireSpaceMember } from '../middleware/spaceAccess.js'
import accountRoutes from './accountRoutes.js'
import transactionRoutes from './transactionRoutes.js'
import shoppingRoutes from './shoppingRoutes.js'
import itemProfileRoutes from './itemProfileRoutes.js'
import billRoutes from './billRoutes.js'
import {
  billPaymentRouter,
  electricityRouter,
} from './electricityRoutes.js'
import attachmentRoutes from './attachmentRoutes.js'
import reconciliationRoutes from './reconciliationRoutes.js'
import {
  addMember,
  createSpace,
  deleteSpace,
  getSpace,
  leaveSpace,
  listMembers,
  listMySpaces,
  removeMember,
  updateMemberRole,
  updateSpace,
} from '../controllers/spaceController.js'

const router = Router()

router.use(authenticate)

router.get('/', listMySpaces)
router.post('/', createSpace)

router.get('/:spaceId', requireSpaceMember('VIEWER'), getSpace)
router.patch('/:spaceId', requireSpaceMember('OWNER'), updateSpace)
router.delete('/:spaceId', requireSpaceMember('OWNER'), deleteSpace)

router.post(
  '/:spaceId/leave',
  requireSpaceMember('VIEWER'),
  leaveSpace,
)

router.get(
  '/:spaceId/members',
  requireSpaceMember('VIEWER'),
  listMembers,
)
router.post(
  '/:spaceId/members',
  requireSpaceMember('OWNER'),
  addMember,
)
router.patch(
  '/:spaceId/members/:userId',
  requireSpaceMember('OWNER'),
  updateMemberRole,
)
router.delete(
  '/:spaceId/members/:userId',
  requireSpaceMember('OWNER'),
  removeMember,
)

router.use('/:spaceId/accounts', accountRoutes)
router.use('/:spaceId/transactions', transactionRoutes)
router.use('/:spaceId/shopping-lists', shoppingRoutes)
router.use('/:spaceId/item-profiles', itemProfileRoutes)
router.use('/:spaceId/bills', billRoutes)
router.use('/:spaceId/electricity', electricityRouter)
router.use('/:spaceId/bill-payments', billPaymentRouter)
router.use('/:spaceId/attachments', attachmentRoutes)
router.use('/:spaceId/reconciliations', reconciliationRoutes)

export default router
