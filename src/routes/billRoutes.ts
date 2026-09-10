import { Router } from 'express'
import { requireSpaceMember } from '../middleware/spaceAccess.js'
import {
  createBill,
  deleteBill,
  getBill,
  listBillPayments,
  listBills,
  payBill,
  updateBill,
} from '../controllers/billController.js'

const router = Router({ mergeParams: true })

const read = requireSpaceMember('VIEWER')
const write = requireSpaceMember('EDITOR')

router.get('/', read, listBills)
router.post('/', write, createBill)
router.get('/:billId', read, getBill)
router.patch('/:billId', write, updateBill)
router.delete('/:billId', write, deleteBill)
router.post('/:billId/pay', write, payBill)
router.get('/:billId/payments', read, listBillPayments)

export default router
