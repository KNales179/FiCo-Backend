import crypto from 'crypto'
import mongoose from 'mongoose'
import InviteCode, { type IInviteCode } from '../models/InviteCode.js'

// No 0/O or 1/I/L — codes get read aloud and typed from screenshots.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const PREFIX = 'FICO'

/** How long a new code stays usable. */
export const INVITE_TTL_MS = 60 * 60 * 1000

const randomPart = (n: number) =>
  Array.from({ length: n }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('')

/** Letters and digits only, upper-cased; the "FICO" prefix is optional when typed. */
export const inviteKeyOf = (raw: string) => {
  const key = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return key.startsWith(PREFIX) ? key : PREFIX + key
}

export const newInviteCode = async (createdBy: string, note?: string | null) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const a = randomPart(4)
    const b = randomPart(4)
    try {
      return await InviteCode.create({
        code: `${PREFIX}-${a}-${b}`,
        key: `${PREFIX}${a}${b}`,
        note: note?.trim() || null,
        createdBy,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      })
    } catch (error) {
      // A clash on the unique key (vanishingly rare) — just roll again.
      if ((error as { code?: number }).code !== 11000) throw error
    }
  }
  throw new Error('Could not make a unique invite code')
}

const usable = () => ({ usedBy: null, revokedAt: null, expiresAt: { $gt: new Date() } })

/** An unused, uncancelled, unexpired code matching what was typed — or null. */
export const findUsableInvite = async (raw: string | undefined | null): Promise<IInviteCode | null> => {
  if (!raw?.trim()) return null
  return InviteCode.findOne({ key: inviteKeyOf(raw), ...usable() })
}

/** Why a typed code can't be used — so the person knows to ask for a new one. */
export const inviteProblem = async (raw: string | undefined | null): Promise<string> => {
  const code = raw?.trim() ? await InviteCode.findOne({ key: inviteKeyOf(raw) }) : null
  if (!code) return 'That invite code isn’t valid — check it, or ask for a new one'
  if (code.usedBy || code.usedAt) return 'That invite code has already been used — ask for a new one'
  if (code.revokedAt) return 'That invite code was cancelled — ask for a new one'
  return 'That invite code has expired (codes last 1 hour) — ask for a new one'
}

/**
 * Marks the code used by this account — atomically, so two people racing
 * with the same code can't both get in. False if someone else got there first.
 */
export const claimInvite = async (invite: IInviteCode, userId: string | mongoose.Types.ObjectId) => {
  const claimed = await InviteCode.findOneAndUpdate(
    { _id: invite._id, ...usable() },
    { $set: { usedBy: userId, usedAt: new Date() } },
    { new: true },
  )
  return Boolean(claimed)
}

export const INVITE_REQUIRED_MESSAGE =
  'Fico is invite-only for now — you need an invite code to create an account.'
