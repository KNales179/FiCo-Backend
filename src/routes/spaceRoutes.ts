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
import categoryRoutes from './categoryRoutes.js'
import analyticsRoutes from './analyticsRoutes.js'
import actionLogRoutes from './actionLogRoutes.js'
import syncRoutes from './syncRoutes.js'
import {
  addMember,
  createInvitation,
  createSpace,
  deleteSpace,
  getSpace,
  leaveSpace,
  listInvitations,
  listMembers,
  listMySpaces,
  removeMember,
  revokeInvitation,
  transferOwnership,
  updateSpace,
} from '../controllers/spaceController.js'

const router = Router()

router.use(authenticate)

router.get('/', listMySpaces)
router.post('/', createSpace)

router.get('/:spaceId', requireSpaceMember('MEMBER'), getSpace)
router.patch('/:spaceId', requireSpaceMember('OWNER'), updateSpace)
router.delete('/:spaceId', requireSpaceMember('OWNER'), deleteSpace)

router.post(
  '/:spaceId/leave',
  requireSpaceMember('MEMBER'),
  leaveSpace,
)

router.get(
  '/:spaceId/members',
  requireSpaceMember('MEMBER'),
  listMembers,
)
router.post(
  '/:spaceId/members',
  requireSpaceMember('OWNER'),
  addMember,
)
router.post(
  '/:spaceId/transfer-ownership',
  requireSpaceMember('OWNER'),
  transferOwnership,
)
router.delete(
  '/:spaceId/members/:userId',
  requireSpaceMember('OWNER'),
  removeMember,
)

router.get(
  '/:spaceId/invitations',
  requireSpaceMember('OWNER'),
  listInvitations,
)
router.post(
  '/:spaceId/invitations',
  requireSpaceMember('OWNER'),
  createInvitation,
)
router.delete(
  '/:spaceId/invitations/:invitationId',
  requireSpaceMember('OWNER'),
  revokeInvitation,
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
router.use('/:spaceId/categories', categoryRoutes)
router.use('/:spaceId/analytics', analyticsRoutes)
router.use('/:spaceId/action-logs', actionLogRoutes)
router.use('/:spaceId/sync', syncRoutes)

export default router
