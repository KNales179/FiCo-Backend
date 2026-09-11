import { Router } from 'express'
import { requireSpaceMember } from '../middleware/spaceAccess.js'
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '../controllers/categoryController.js'

const router = Router({ mergeParams: true })

router.get('/', requireSpaceMember('MEMBER'), listCategories)
router.post('/', requireSpaceMember('MEMBER'), createCategory)
router.patch('/:categoryId', requireSpaceMember('MEMBER'), updateCategory)
router.delete('/:categoryId', requireSpaceMember('MEMBER'), deleteCategory)

export default router
