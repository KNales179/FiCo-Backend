import { NextFunction, Response } from 'express'
import mongoose from 'mongoose'
import Account from '../models/Account.js'
import ShoppingItem, { IShoppingItem } from '../models/ShoppingItem.js'
import ShoppingList, { IShoppingList } from '../models/ShoppingList.js'
import Transaction from '../models/Transaction.js'
import { SpaceRequest } from '../middleware/spaceAccess.js'
import { computeListTotals } from '../services/shoppingService.js'
import {
  recordPurchasePrice,
  resolveItemProfile,
} from '../services/itemIntelligenceService.js'
import {
  addItemSchema,
  createListSchema,
  updateItemSchema,
  updateListSchema,
} from '../validation/shoppingValidation.js'

const serializeList = (list: IShoppingList) => ({
  id: String(list._id),
  spaceId: String(list.spaceId),
  title: list.title,
  status: list.status,
  plannedBudgetMinor: list.plannedBudgetMinor ?? null,
  plannedAt: list.plannedAt ?? null,
  completedAt: list.completedAt ?? null,
  createdBy: String(list.createdBy),
  createdAt: list.createdAt,
  updatedAt: list.updatedAt,
})

const serializeItem = (item: IShoppingItem) => ({
  id: String(item._id),
  shoppingListId: String(item.shoppingListId),
  itemProfileId: item.itemProfileId ? String(item.itemProfileId) : null,
  name: item.name,
  plannedPriceMinor: item.plannedPriceMinor ?? null,
  actualPriceMinor: item.actualPriceMinor ?? null,
  quantity: item.quantity,
  checked: item.checked,
  purchased: item.purchased,
  addedDuringTrip: item.addedDuringTrip,
  transactionId: item.transactionId ? String(item.transactionId) : null,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
})

const loadList = async (
  spaceId: mongoose.Types.ObjectId,
  listIdParam: string | string[],
) => {
  const listId = String(listIdParam)
  if (!mongoose.Types.ObjectId.isValid(listId)) return null
  return ShoppingList.findOne({ _id: listId, spaceId, deletedAt: null })
}

const loadItems = (listId: mongoose.Types.ObjectId | string) =>
  ShoppingItem.find({ shoppingListId: listId, deletedAt: null }).sort({
    createdAt: 1,
  })

/** GET /api/spaces/:spaceId/shopping-lists */
export const listShoppingLists = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const filter: Record<string, unknown> = {
      spaceId: req.space!._id,
      deletedAt: null,
    }
    if (typeof req.query.status === 'string') {
      filter.status = req.query.status
    }

    const lists = await ShoppingList.find(filter).sort({ updatedAt: -1 })

    const itemsByList = new Map<string, IShoppingItem[]>()
    const allItems = await ShoppingItem.find({
      shoppingListId: { $in: lists.map((l) => l._id) },
      deletedAt: null,
    })
    for (const item of allItems) {
      const key = String(item.shoppingListId)
      const arr = itemsByList.get(key) ?? []
      arr.push(item)
      itemsByList.set(key, arr)
    }

    const payload = lists.map((list) => ({
      ...serializeList(list),
      totals: computeListTotals(
        list,
        itemsByList.get(String(list._id)) ?? [],
      ),
    }))

    return res.json({ success: true, lists: payload })
  } catch (error) {
    next(error)
  }
}

/** POST /api/spaces/:spaceId/shopping-lists */
export const createShoppingList = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = createListSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid list data',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const list = await ShoppingList.create({
      spaceId: req.space!._id,
      title: result.data.title,
      plannedBudgetMinor: result.data.plannedBudgetMinor ?? null,
      plannedAt: result.data.plannedAt
        ? new Date(result.data.plannedAt)
        : null,
      status: 'ACTIVE',
      createdBy: req.user!.id,
    })

    return res.status(201).json({
      success: true,
      message: 'Shopping list created',
      list: { ...serializeList(list), totals: computeListTotals(list, []) },
      items: [],
    })
  } catch (error) {
    next(error)
  }
}

/** GET /api/spaces/:spaceId/shopping-lists/:listId */
export const getShoppingList = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const list = await loadList(req.space!._id, req.params.listId)
    if (!list) {
      return res
        .status(404)
        .json({ success: false, message: 'List not found' })
    }

    const items = await loadItems(list._id)

    return res.json({
      success: true,
      list: {
        ...serializeList(list),
        totals: computeListTotals(list, items),
      },
      items: items.map(serializeItem),
    })
  } catch (error) {
    next(error)
  }
}

/** PATCH /api/spaces/:spaceId/shopping-lists/:listId */
export const updateShoppingList = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = updateListSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid list data',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const list = await loadList(req.space!._id, req.params.listId)
    if (!list) {
      return res
        .status(404)
        .json({ success: false, message: 'List not found' })
    }
    if (list.status === 'COMPLETED') {
      return res.status(409).json({
        success: false,
        message: 'A completed list can no longer be changed',
      })
    }

    if (result.data.title !== undefined) list.title = result.data.title
    if (result.data.plannedBudgetMinor !== undefined) {
      list.plannedBudgetMinor = result.data.plannedBudgetMinor
    }
    if (result.data.status !== undefined) list.status = result.data.status

    await list.save()
    const items = await loadItems(list._id)

    return res.json({
      success: true,
      message: 'List updated',
      list: {
        ...serializeList(list),
        totals: computeListTotals(list, items),
      },
      items: items.map(serializeItem),
    })
  } catch (error) {
    next(error)
  }
}

/** DELETE /api/spaces/:spaceId/shopping-lists/:listId — soft delete. */
export const deleteShoppingList = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const list = await loadList(req.space!._id, req.params.listId)
    if (!list) {
      return res
        .status(404)
        .json({ success: false, message: 'List not found' })
    }

    list.deletedAt = new Date()
    await list.save()
    await ShoppingItem.updateMany(
      { shoppingListId: list._id, deletedAt: null },
      { $set: { deletedAt: new Date() } },
    )

    return res.json({ success: true, message: 'List deleted' })
  } catch (error) {
    next(error)
  }
}

/**
 * POST /api/spaces/:spaceId/shopping-lists/:listId/complete
 * body: { accountId? }
 *
 * Marks the list COMPLETED and turns every checked item that has an actual
 * price into an EXPENSE transaction paid from `accountId` (or the space's
 * default account). Idempotent: an item that already has a linked transaction
 * is skipped, so re-running creates no duplicates (Architecture §20, §38,
 * Roadmap Phase 9).
 */
export const completeShoppingList = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const spaceId = req.space!._id
    const list = await loadList(spaceId, req.params.listId)
    if (!list) {
      return res
        .status(404)
        .json({ success: false, message: 'List not found' })
    }
    if (list.status === 'COMPLETED') {
      return res
        .status(409)
        .json({ success: false, message: 'List is already completed' })
    }

    const requestedId =
      typeof req.body?.accountId === 'string' ? req.body.accountId : null

    const account = requestedId
      ? await Account.findOne({
          _id: mongoose.Types.ObjectId.isValid(requestedId)
            ? requestedId
            : null,
          spaceId,
          deletedAt: null,
          status: 'ACTIVE',
        })
      : ((await Account.findOne({
          spaceId,
          deletedAt: null,
          status: 'ACTIVE',
          isDefault: true,
        })) ??
        (await Account.findOne({
          spaceId,
          deletedAt: null,
          status: 'ACTIVE',
        })))

    if (!account) {
      return res.status(422).json({
        success: false,
        message: 'Choose an active account to pay from',
      })
    }

    const items = await loadItems(list._id)

    let createdCount = 0
    let spentMinor = 0
    for (const item of items) {
      if (
        !item.checked ||
        item.transactionId ||
        item.actualPriceMinor == null ||
        item.actualPriceMinor <= 0
      ) {
        continue
      }

      const purchasedAt = new Date()

      // Learn the item: profile + category snapshot + price history (§9, §10).
      const profile = await resolveItemProfile(spaceId, item.name)

      const txn = await Transaction.create({
        spaceId,
        type: 'EXPENSE',
        amountMinor: item.actualPriceMinor,
        currency: account.currency,
        title: item.name,
        categoryName: profile.category ?? null,
        accountId: account._id,
        occurredAt: purchasedAt,
        sourceType: 'SHOPPING_ITEM',
        sourceId: String(item._id),
        createdBy: req.user!.id,
      })

      await recordPurchasePrice({
        spaceId,
        itemProfileId: profile._id as mongoose.Types.ObjectId,
        amountMinor: item.actualPriceMinor,
        purchasedAt,
        transactionId: txn._id as mongoose.Types.ObjectId,
      })

      item.transactionId = txn._id as mongoose.Types.ObjectId
      item.itemProfileId = profile._id as mongoose.Types.ObjectId
      item.purchased = true
      await item.save()
      createdCount += 1
      spentMinor += item.actualPriceMinor
    }

    list.status = 'COMPLETED'
    list.completedAt = new Date()
    await list.save()

    const fresh = await loadItems(list._id)

    return res.json({
      success: true,
      message: `Shopping completed — ${createdCount} expense${
        createdCount === 1 ? '' : 's'
      } recorded`,
      list: {
        ...serializeList(list),
        totals: computeListTotals(list, fresh),
      },
      items: fresh.map(serializeItem),
      expenses: {
        accountId: String(account._id),
        createdCount,
        spentMinor,
      },
    })
  } catch (error) {
    next(error)
  }
}

/** POST /api/spaces/:spaceId/shopping-lists/:listId/items */
export const addShoppingItem = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = addItemSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid item data',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const list = await loadList(req.space!._id, req.params.listId)
    if (!list) {
      return res
        .status(404)
        .json({ success: false, message: 'List not found' })
    }
    if (list.status !== 'ACTIVE') {
      return res.status(409).json({
        success: false,
        message: 'This list is no longer active',
      })
    }

    const item = await ShoppingItem.create({
      spaceId: req.space!._id,
      shoppingListId: list._id,
      name: result.data.name,
      plannedPriceMinor: result.data.plannedPriceMinor ?? null,
      quantity: result.data.quantity ?? 1,
      addedDuringTrip: result.data.addedDuringTrip ?? false,
      createdBy: req.user!.id,
    })

    return res.status(201).json({
      success: true,
      message: 'Item added',
      item: serializeItem(item),
    })
  } catch (error) {
    next(error)
  }
}

/** PATCH /api/spaces/:spaceId/shopping-lists/:listId/items/:itemId */
export const updateShoppingItem = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = updateItemSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid item data',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const list = await loadList(req.space!._id, req.params.listId)
    if (!list) {
      return res
        .status(404)
        .json({ success: false, message: 'List not found' })
    }
    if (list.status === 'COMPLETED') {
      return res.status(409).json({
        success: false,
        message: 'A completed list can no longer be changed',
      })
    }

    const item = await ShoppingItem.findOne({
      _id: req.params.itemId,
      shoppingListId: list._id,
      deletedAt: null,
    }).catch(() => null)

    if (!item) {
      return res
        .status(404)
        .json({ success: false, message: 'Item not found' })
    }

    const data = result.data
    if (data.name !== undefined) item.name = data.name
    if (data.plannedPriceMinor !== undefined) {
      item.plannedPriceMinor = data.plannedPriceMinor
    }
    if (data.actualPriceMinor !== undefined) {
      item.actualPriceMinor = data.actualPriceMinor
    }
    if (data.quantity !== undefined) item.quantity = data.quantity
    if (data.checked !== undefined) item.checked = data.checked

    await item.save()

    return res.json({
      success: true,
      message: 'Item updated',
      item: serializeItem(item),
    })
  } catch (error) {
    next(error)
  }
}

/** DELETE /api/spaces/:spaceId/shopping-lists/:listId/items/:itemId — soft delete. */
export const deleteShoppingItem = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const list = await loadList(req.space!._id, req.params.listId)
    if (!list) {
      return res
        .status(404)
        .json({ success: false, message: 'List not found' })
    }
    if (list.status === 'COMPLETED') {
      return res.status(409).json({
        success: false,
        message: 'A completed list can no longer be changed',
      })
    }

    const item = await ShoppingItem.findOne({
      _id: req.params.itemId,
      shoppingListId: list._id,
      deletedAt: null,
    }).catch(() => null)

    if (!item) {
      return res
        .status(404)
        .json({ success: false, message: 'Item not found' })
    }

    item.deletedAt = new Date()
    await item.save()

    return res.json({ success: true, message: 'Item removed' })
  } catch (error) {
    next(error)
  }
}
