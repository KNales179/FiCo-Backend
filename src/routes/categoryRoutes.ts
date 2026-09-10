import { Router } from 'express'
import { requireSpaceMember } from '../middleware/spaceAccess.js'
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '../controllers/categoryController.js'

const router = Router({ mergeParams: true })

router.get('/', requireSpaceMember('VIEWER'), listCategories)
router.post('/', requireSpaceMember('EDITOR'), createCategory)
router.patch('/:categoryId', requireSpaceMember('EDITOR'), updateCategory)
router.delete('/:categoryId', requireSpaceMember('EDITOR'), deleteCategory)

export default router
