import crypto from 'crypto'

/**
 * TOTP (RFC 6238) / HOTP (RFC 4226), implemented directly against Node's
 * built-in `crypto` rather than a third-party authenticator library — this
 * is the second factor gating admin accounts, so it stays small enough to
 * read end to end and has no dependency surface of its own.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const TIME_STEP_SECONDS = 30
const DIGITS = 6
/** Tolerate the previous/next 30s step either side, for clock drift. */
const VERIFY_WINDOW = 1

const base32Encode = (buffer: Buffer): string => {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

const base32Decode = (input: string): Buffer => {
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) continue
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** A fresh 160-bit secret, base32-encoded for both storage and display. */
export const generateTotpSecret = (): string =>
  base32Encode(crypto.randomBytes(20))

const hotp = (secret: Buffer, counter: number, digits = DIGITS): string => {
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))
  const hmac = crypto.createHmac('sha1', secret).update(counterBuffer).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(code % 10 ** digits).padStart(digits, '0')
}

/** The current 6-digit code for this secret — mainly for tests/tooling. */
export const generateTotp = (
  secretBase32: string,
  at: number = Date.now(),
): string => {
  const counter = Math.floor(at / 1000 / TIME_STEP_SECONDS)
  return hotp(base32Decode(secretBase32), counter)
}

/**
 * Checks a submitted code against the current time step and one step
 * either side (±30s), so a slightly-off device clock doesn't lock someone
 * out. Constant-time compare per candidate so a valid code can't be
 * inferred from response timing.
 */
export const verifyTotp = (
  token: string,
  secretBase32: string,
  at: number = Date.now(),
): boolean => {
  const candidate = token.trim()
  if (!/^\d{6}$/.test(candidate)) return false

  const secret = base32Decode(secretBase32)
  const counter = Math.floor(at / 1000 / TIME_STEP_SECONDS)
  const candidateBuffer = Buffer.from(candidate)

  for (let drift = -VERIFY_WINDOW; drift <= VERIFY_WINDOW; drift += 1) {
    const expected = Buffer.from(hotp(secret, counter + drift))
    if (crypto.timingSafeEqual(expected, candidateBuffer)) return true
  }
  return false
}

/** `otpauth://` URI for manual entry (or a QR code) in an authenticator app. */
export const totpKeyUri = (
  secretBase32: string,
  accountLabel: string,
  issuer = 'Fico',
): string => {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`)
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(TIME_STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

/** A batch of one-time-use backup codes, formatted for readability (XXXX-XXXX). */
export const generateBackupCodes = (count = 8): string[] =>
  Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase() // 10 hex chars
    return `${raw.slice(0, 5)}-${raw.slice(5)}`
  })
