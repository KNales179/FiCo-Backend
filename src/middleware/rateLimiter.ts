import rateLimit from 'express-rate-limit'

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message:
      'Too many login attempts. Please try again later.',
  },
})

export const registerRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message:
      'Too many registration attempts. Please try again later.',
  },
})

/** A 6-digit code has only a million combinations — keep guessing expensive. */
export const twoFactorRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many attempts. Please try again later.',
  },
})

/** Generous cap for the sync endpoints — a healthy client polls every 45s. */
export const syncRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Syncing too frequently. Slow down.',
  },
})

/** Changing your own password/security settings — same tier as 2FA attempts. */
export const accountSecurityRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many attempts. Please try again later.',
  },
})

/**
 * Actions an admin takes on someone *else's* account — password resets,
 * role changes, forced sign-outs. A real admin doesn't do dozens of these
 * a minute; a compromised admin session or a runaway script might.
 */
export const adminActionRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many admin actions in a row. Slow down.',
  },
})

/**
 * Any endpoint that sends an email — resending a verification link,
 * starting a password reset. Same tier as registration: emails cost real
 * provider quota, and this is a classic target for "spam someone's inbox"
 * abuse.
 */
export const emailSendRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
  },
})

/** Receipt/attachment uploads — bounded separately from ordinary API calls since each one costs real Cloudinary bandwidth. */
export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many uploads in a row. Please slow down.',
  },
})