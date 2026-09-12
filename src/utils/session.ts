import crypto from 'crypto'

export const generateSessionId = (): string => {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * The frontend (Vercel) and backend (Render, or any separate host) live on
 * different domains in production — a genuinely cross-site relationship as
 * far as the browser is concerned, not just cross-port like local dev.
 * `SameSite=Lax` is never sent on a cross-site fetch/XHR (only on a
 * top-level navigation), so with `lax` the login response would set the
 * cookie but the browser would then silently withhold it from every
 * subsequent API call — looking exactly like "login succeeds, everything
 * after it 401s". `SameSite=None` is required for that cross-site fetch to
 * carry the cookie, and browsers only honor `None` when `Secure` is also
 * set — which is already true in production. Local dev keeps `lax`
 * (frontend/backend are same-site there, and `None` needs HTTPS, which
 * plain `npm run dev` doesn't have).
 *
 * Setting and clearing the cookie must use the *same* attributes, or the
 * browser won't recognize a `clearCookie` call as targeting the cookie it
 * actually set — every `res.cookie('fico_session', ...)` /
 * `res.clearCookie('fico_session', ...)` call site should use this.
 */
export const sessionCookieOptions = () => {
  const production = process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    secure: production,
    sameSite: (production ? 'none' : 'lax') as 'none' | 'lax',
    path: '/',
  }
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
