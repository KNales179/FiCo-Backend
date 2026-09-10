import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import multer from 'multer'

export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads')

fs.mkdirSync(UPLOAD_DIR, { recursive: true })

/** Allowed receipt/document types (Architecture §30). */
const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'application/pdf': '.pdf',
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // Never trust the client filename as a path — generate our own.
    const ext = ALLOWED_MIME[file.mimetype] ?? ''
    cb(null, `${crypto.randomUUID()}${ext}`)
  },
})

export const uploadReceipt = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME[file.mimetype]) {
      cb(null, true)
    } else {
      cb(new Error('UNSUPPORTED_FILE_TYPE'))
    }
  },
})
