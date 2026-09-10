import { NextFunction, Request, Response, Router } from 'express'
import { MulterError } from 'multer'
import { requireSpaceMember } from '../middleware/spaceAccess.js'
import { MAX_FILE_BYTES, uploadReceipt } from '../middleware/upload.js'
import {
  deleteAttachment,
  downloadAttachment,
  listAttachments,
  uploadAttachment,
} from '../controllers/attachmentController.js'

const router = Router({ mergeParams: true })

const read = requireSpaceMember('VIEWER')
const write = requireSpaceMember('EDITOR')

/** Turn multer's errors into clean 400/413 responses. */
const handleUpload = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  uploadReceipt.single('file')(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `File is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB`
          : 'Upload failed'
      return res.status(413).json({ success: false, message })
    }
    if (err instanceof Error) {
      if (err.message === 'UNSUPPORTED_FILE_TYPE') {
        return res.status(415).json({
          success: false,
          message: 'Only images and PDF files are allowed',
        })
      }
      return next(err)
    }
    next()
  })
}

router.get('/', read, listAttachments)
router.post('/', write, handleUpload, uploadAttachment)
router.get('/:attachmentId/file', read, downloadAttachment)
router.delete('/:attachmentId', write, deleteAttachment)

export default router
