import { Router } from 'express'
import { requireSpaceMember } from '../middleware/spaceAccess.js'
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  updateTransaction,
} from '../controllers/transactionController.js'

const router = Router({ mergeParams: true })

router.get('/', requireSpaceMember('MEMBER'), listTransactions)
router.post('/', requireSpaceMember('MEMBER'), createTransaction)
router.get(
  '/:transactionId',
  requireSpaceMember('MEMBER'),
  getTransaction,
)
router.patch(
  '/:transactionId',
  requireSpaceMember('MEMBER'),
  updateTransaction,
)
router.delete(
  '/:transactionId',
  requireSpaceMember('MEMBER'),
  deleteTransaction,
)

export default router
