import { Router } from 'express'
import { requireSpaceMember } from '../middleware/spaceAccess.js'
import {
  addShoppingItem,
  completeShoppingList,
  createShoppingList,
  deleteShoppingItem,
  deleteShoppingList,
  getShoppingList,
  listShoppingLists,
  updateShoppingItem,
  updateShoppingList,
} from '../controllers/shoppingController.js'

const router = Router({ mergeParams: true })

const read = requireSpaceMember('VIEWER')
const write = requireSpaceMember('EDITOR')

router.get('/', read, listShoppingLists)
router.post('/', write, createShoppingList)
router.get('/:listId', read, getShoppingList)
router.patch('/:listId', write, updateShoppingList)
router.delete('/:listId', write, deleteShoppingList)
router.post('/:listId/complete', write, completeShoppingList)

router.post('/:listId/items', write, addShoppingItem)
router.patch('/:listId/items/:itemId', write, updateShoppingItem)
router.delete('/:listId/items/:itemId', write, deleteShoppingItem)

export default router
