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

router.get('/', requireSpaceMember('MEMBER'), listAccounts)
router.post('/', requireSpaceMember('MEMBER'), createAccount)
router.get('/:accountId', requireSpaceMember('MEMBER'), getAccount)
router.patch('/:accountId', requireSpaceMember('MEMBER'), updateAccount)
router.delete('/:accountId', requireSpaceMember('MEMBER'), deleteAccount)

export default router
