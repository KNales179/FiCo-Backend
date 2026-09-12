import crypto from 'crypto'

/** A high-entropy, single-use token for an emailed link (verification, password reset). */
export const generateToken = (): string => crypto.randomBytes(32).toString('hex')

/**
 * Hash a token for storage, the same reasoning as hashing a password reset
 * token anywhere else: a database leak alone should never hand out working
 * links. Unkeyed SHA-256 is fine here (unlike a session id) because the
 * token itself is already 256 bits of real randomness, not something an
 * attacker could feasibly narrow down offline.
 */
export const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex')
