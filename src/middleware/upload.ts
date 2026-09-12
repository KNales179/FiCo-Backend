import multer from 'multer'

/** Allowed receipt/document types (Architecture §30). */
export const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'application/pdf',
])

export const MAX_FILE_BYTES = 10 * 1024 * 1024

/**
 * Keeps the upload in memory — it goes straight to Cloudinary, nothing touches
 * this server's disk.
 */
export const uploadReceipt = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('UNSUPPORTED_FILE_TYPE'))
    }
  },
})

const AVATAR_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024

/** A profile picture — images only, smaller cap than a receipt/document. */
export const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (AVATAR_MIME.has(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('UNSUPPORTED_FILE_TYPE'))
    }
  },
})
