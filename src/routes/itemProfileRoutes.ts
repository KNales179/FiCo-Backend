import { Router } from 'express'
import { requireSpaceMember } from '../middleware/spaceAccess.js'
import {
  itemPriceHistory,
  listItemProfiles,
  suggestItem,
  updateItemProfile,
} from '../controllers/itemProfileController.js'

const router = Router({ mergeParams: true })

router.get('/', requireSpaceMember('MEMBER'), listItemProfiles)
router.get('/suggest', requireSpaceMember('MEMBER'), suggestItem)
router.get(
  '/:profileId/prices',
  requireSpaceMember('MEMBER'),
  itemPriceHistory,
)
router.patch(
  '/:profileId',
  requireSpaceMember('MEMBER'),
  updateItemProfile,
)

export default router
