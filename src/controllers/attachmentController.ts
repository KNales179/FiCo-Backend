import fs from 'fs'
import path from 'path'
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
import { UPLOAD_DIR } from '../middleware/upload.js'

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

const removeFileQuietly = (storageKey: string) => {
  fs.promises
    .unlink(path.join(UPLOAD_DIR, storageKey))
    .catch(() => undefined)
}

/**
 * POST /api/spaces/:spaceId/attachments  (multipart: file, entityType, entityId)
 * The uploaded file is already on disk under a generated name; here we validate
 * the target and persist the metadata.
 */
export const uploadAttachment = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
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
      removeFileQuietly(file.filename)
      return res.status(422).json({
        success: false,
        message: 'That record does not exist in this space',
      })
    }

    const attachment = await Attachment.create({
      spaceId: req.space!._id,
      entityType,
      entityId,
      fileName: file.originalname.slice(0, 260),
      mimeType: file.mimetype,
      size: file.size,
      storageKey: file.filename,
      createdBy: req.user!.id,
    })

    return res.status(201).json({
      success: true,
      message: 'Attachment saved',
      attachment: serialize(attachment),
    })
  } catch (error) {
    if (req.file) removeFileQuietly(req.file.filename)
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

/** GET /api/spaces/:spaceId/attachments/:attachmentId/file — access-controlled download. */
export const downloadAttachment = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const attachment = await Attachment.findOne({
      _id: mongoose.Types.ObjectId.isValid(String(req.params.attachmentId))
        ? String(req.params.attachmentId)
        : null,
      spaceId: req.space!._id,
      deletedAt: null,
    })

    if (!attachment) {
      return res
        .status(404)
        .json({ success: false, message: 'Attachment not found' })
    }

    const filePath = path.join(UPLOAD_DIR, attachment.storageKey)
    if (!fs.existsSync(filePath)) {
      return res
        .status(404)
        .json({ success: false, message: 'File is missing on the server' })
    }

    res.setHeader('Content-Type', attachment.mimeType)
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(attachment.fileName)}"`,
    )
    res.setHeader('X-Content-Type-Options', 'nosniff')
    fs.createReadStream(filePath).pipe(res)
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
      _id: mongoose.Types.ObjectId.isValid(String(req.params.attachmentId))
        ? String(req.params.attachmentId)
        : null,
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
    removeFileQuietly(attachment.storageKey)

    return res.json({ success: true, message: 'Attachment removed' })
  } catch (error) {
    next(error)
  }
}
