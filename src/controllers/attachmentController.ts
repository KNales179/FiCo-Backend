import { NextFunction, Response } from 'express'
import mongoose from 'mongoose'
import Attachment, {
  AttachmentEntityType,
  IAttachment,
} from '../models/Attachment.js'
import BillPayment from '../models/BillPayment.js'
import ElectricityRecord from '../models/ElectricityRecord.js'
import ShoppingItem from '../models/ShoppingItem.js'
import Transaction from '../models/Transaction.js'
import { SpaceRequest } from '../middleware/spaceAccess.js'
import {
  deleteReceipt,
  isStorageConfigured,
  receiptUrl,
  uploadReceipt,
} from '../services/attachmentStorage.js'

const serialize = (a: IAttachment) => ({
  id: String(a._id),
  entityType: a.entityType,
  entityId: String(a.entityId),
  fileName: a.fileName,
  mimeType: a.mimeType,
  size: a.size,
  createdBy: String(a.createdBy),
  createdAt: a.createdAt,
})

const objectId = (value: string | string[]) => {
  const id = String(value)
  return mongoose.Types.ObjectId.isValid(id) ? id : null
}

/** Confirms the entity an attachment targets exists in this space. */
const entityExistsInSpace = async (
  spaceId: mongoose.Types.ObjectId,
  entityType: AttachmentEntityType,
  entityId: string,
): Promise<boolean> => {
  if (!mongoose.Types.ObjectId.isValid(entityId)) return false
  const q = { _id: entityId, spaceId, deletedAt: null }

  switch (entityType) {
    case 'TRANSACTION':
      return Boolean(await Transaction.exists(q))
    case 'SHOPPING_ITEM':
      return Boolean(await ShoppingItem.exists(q))
    case 'BILL_PAYMENT':
      return Boolean(await BillPayment.exists(q))
    case 'ELECTRICITY_RECORD':
      return Boolean(
        await ElectricityRecord.exists({ _id: entityId, spaceId }),
      )
    default:
      return false
  }
}

/**
 * POST /api/spaces/:spaceId/attachments  (multipart: file, entityType, entityId)
 * The file is held in memory, validated against its target, uploaded to
 * Cloudinary as an authenticated asset, and only its metadata is persisted.
 */
export const uploadAttachment = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!isStorageConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Attachment storage is not configured on the server',
      })
    }

    const file = req.file
    if (!file) {
      return res
        .status(400)
        .json({ success: false, message: 'No file uploaded' })
    }

    const entityType = String(
      req.body?.entityType ?? '',
    ) as AttachmentEntityType
    const entityId = String(req.body?.entityId ?? '')

    const allowed: AttachmentEntityType[] = [
      'TRANSACTION',
      'SHOPPING_ITEM',
      'BILL_PAYMENT',
      'ELECTRICITY_RECORD',
    ]

    if (
      !allowed.includes(entityType) ||
      !(await entityExistsInSpace(req.space!._id, entityType, entityId))
    ) {
      return res.status(422).json({
        success: false,
        message: 'That record does not exist in this space',
      })
    }

    const stored = await uploadReceipt(file.buffer, file.mimetype)

    const attachment = await Attachment.create({
      spaceId: req.space!._id,
      entityType,
      entityId,
      fileName: file.originalname.slice(0, 260),
      mimeType: file.mimetype,
      size: stored.bytes || file.size,
      storageKey: stored.storageKey,
      resourceType: stored.resourceType,
      createdBy: req.user!.id,
    })

    return res.status(201).json({
      success: true,
      message: 'Attachment saved',
      attachment: serialize(attachment),
    })
  } catch (error) {
    next(error)
  }
}

/** GET /api/spaces/:spaceId/attachments?entityType=&entityId= */
export const listAttachments = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const filter: Record<string, unknown> = {
      spaceId: req.space!._id,
      deletedAt: null,
    }
    if (typeof req.query.entityType === 'string') {
      filter.entityType = req.query.entityType
    }
    if (
      typeof req.query.entityId === 'string' &&
      mongoose.Types.ObjectId.isValid(req.query.entityId)
    ) {
      filter.entityId = req.query.entityId
    }

    const attachments = await Attachment.find(filter).sort({
      createdAt: -1,
    })

    return res.json({
      success: true,
      attachments: attachments.map(serialize),
    })
  } catch (error) {
    next(error)
  }
}

/**
 * GET /api/spaces/:spaceId/attachments/:attachmentId/file
 * Redirects to a freshly signed Cloudinary URL — access is gated here by space
 * membership, and the signed URL is what actually authorizes the fetch.
 */
export const downloadAttachment = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const attachment = await Attachment.findOne({
      _id: objectId(req.params.attachmentId),
      spaceId: req.space!._id,
      deletedAt: null,
    })

    if (!attachment) {
      return res
        .status(404)
        .json({ success: false, message: 'Attachment not found' })
    }

    return res.redirect(
      receiptUrl(attachment.storageKey, attachment.resourceType),
    )
  } catch (error) {
    next(error)
  }
}

/** DELETE /api/spaces/:spaceId/attachments/:attachmentId */
export const deleteAttachment = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const attachment = await Attachment.findOne({
      _id: objectId(req.params.attachmentId),
      spaceId: req.space!._id,
      deletedAt: null,
    })

    if (!attachment) {
      return res
        .status(404)
        .json({ success: false, message: 'Attachment not found' })
    }

    attachment.deletedAt = new Date()
    await attachment.save()
    await deleteReceipt(attachment.storageKey, attachment.resourceType)

    return res.json({ success: true, message: 'Attachment removed' })
  } catch (error) {
    next(error)
  }
}
