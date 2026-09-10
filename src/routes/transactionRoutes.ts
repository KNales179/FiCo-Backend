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

router.get('/', requireSpaceMember('VIEWER'), listTransactions)
router.post('/', requireSpaceMember('EDITOR'), createTransaction)
router.get(
  '/:transactionId',
  requireSpaceMember('VIEWER'),
  getTransaction,
)
router.patch(
  '/:transactionId',
  requireSpaceMember('EDITOR'),
  updateTransaction,
)
router.delete(
  '/:transactionId',
  requireSpaceMember('EDITOR'),
  deleteTransaction,
)

export default router
