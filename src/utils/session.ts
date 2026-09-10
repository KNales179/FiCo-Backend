import crypto from 'crypto'

export const generateSessionId = (): string => {
  return crypto.randomBytes(32).toString('hex')
}

export const hashSessionId = (sessionId: string): string => {
  return crypto
    .createHash('sha256')
    .update(sessionId)
    .digest('hex')
}