import crypto from 'crypto'

export const generateSessionId = (): string => {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * Hash a session id for storage. HMAC-SHA256 keyed with SESSION_SECRET so a
 * database leak alone can't be used to look up or forge live sessions.
 *
 * The unkeyed fallback below is deliberately dev-only — `server.ts` refuses
 * to boot in production without `SESSION_SECRET` set, so this branch never
 * actually runs there.
 */
export const hashSessionId = (sessionId: string): string => {
  const secret = process.env.SESSION_SECRET
  if (secret) {
    return crypto
      .createHmac('sha256', secret)
      .update(sessionId)
      .digest('hex')
  }
  return crypto.createHash('sha256').update(sessionId).digest('hex')
}
