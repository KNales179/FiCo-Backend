import { Router } from 'express'
import { requireSpaceMember } from '../middleware/spaceAccess.js'
import {
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  updateAccount,
} from '../controllers/accountController.js'

// mergeParams so `:spaceId` from the parent mount is visible here.
const router = Router({ mergeParams: true })

router.get('/', requireSpaceMember('VIEWER'), listAccounts)
router.post('/', requireSpaceMember('EDITOR'), createAccount)
router.get('/:accountId', requireSpaceMember('VIEWER'), getAccount)
router.patch('/:accountId', requireSpaceMember('EDITOR'), updateAccount)
router.delete('/:accountId', requireSpaceMember('EDITOR'), deleteAccount)

export default router
