import { v2 as cloudinary } from 'cloudinary'

/**
 * Receipt storage on Cloudinary. Files are uploaded as `type: 'authenticated'`,
 * so they can only be fetched through a URL signed with our API secret — which
 * the backend produces only for authorized space members (Architecture §29–§30).
 */

let configured = false

const ensureConfigured = () => {
  if (configured) return

  const {
    CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET,
  } = process.env

  if (
    !CLOUDINARY_CLOUD_NAME ||
    !CLOUDINARY_API_KEY ||
    !CLOUDINARY_API_SECRET
  ) {
    throw new Error('CLOUDINARY_NOT_CONFIGURED')
  }

  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  })
  configured = true
}

export interface StoredFile {
  storageKey: string
  resourceType: string
  bytes: number
}

export const uploadReceipt = async (
  buffer: Buffer,
  mimeType: string,
): Promise<StoredFile> => {
  ensureConfigured()

  const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`

  const result = await cloudinary.uploader.upload(dataUri, {
    folder: 'fico/receipts',
    type: 'authenticated',
    resource_type: 'auto',
    overwrite: false,
  })

  return {
    storageKey: result.public_id,
    resourceType: result.resource_type,
    bytes: result.bytes,
  }
}

/**
 * A signed, secure URL for one stored receipt. The asset is `authenticated`,
 * so it can't be fetched without this signature — which only the backend can
 * produce, and only after checking space membership on the redirect route.
 * (Truly time-limited links need Cloudinary auth-token config; not set up.)
 */
export const receiptUrl = (
  storageKey: string,
  resourceType: string,
): string => {
  ensureConfigured()
  return cloudinary.url(storageKey, {
    type: 'authenticated',
    resource_type: resourceType,
    sign_url: true,
    secure: true,
  })
}

export const deleteReceipt = async (
  storageKey: string,
  resourceType: string,
): Promise<void> => {
  ensureConfigured()
  await cloudinary.uploader
    .destroy(storageKey, {
      type: 'authenticated',
      resource_type: resourceType,
    })
    .catch(() => undefined)
}

export const isStorageConfigured = (): boolean => {
  try {
    ensureConfigured()
    return true
  } catch {
    return false
  }
}
