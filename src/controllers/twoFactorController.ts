import { Response, NextFunction } from 'express'
import User from '../models/User.js'
import { hashPassword, verifyPassword } from '../utils/password.js'
import { generateBackupCodes, generateTotpSecret, totpKeyUri, verifyTotp } from '../utils/totp.js'
import {
  confirmTwoFactorSetupSchema,
  disableTwoFactorSchema,
} from '../validation/authValidation.js'
import { AuthRequest } from '../middleware/authMiddleware.js'

/**
 * Starts (or restarts) 2FA setup: a fresh secret, stored right away but not
 * yet enforced — `totpEnabled` only flips true once `confirmSetup` proves
 * the person actually has it working in their authenticator app, so a
 * setup that's abandoned partway through never locks anyone out.
 */
export const startTwoFactorSetup = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = await User.findById(req.user?.id)
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    const secret = generateTotpSecret()
    user.totpSecret = secret
    user.totpEnabled = false
    await user.save()

    return res.json({
      success: true,
      secret,
      uri: totpKeyUri(secret, user.username),
    })
  } catch (error) {
    next(error)
  }
}

export const confirmTwoFactorSetup = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = confirmTwoFactorSetupSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Enter the 6-digit code from your authenticator app',
      })
    }

    const user = await User.findById(req.user?.id).select('+totpSecret')
    if (!user || !user.totpSecret) {
      return res.status(400).json({
        success: false,
        message: 'Start setup first',
      })
    }

    if (!verifyTotp(result.data.code, user.totpSecret)) {
      return res.status(401).json({ success: false, message: 'Invalid code' })
    }

    const backupCodes = generateBackupCodes()
    user.totpEnabled = true
    user.totpBackupCodeHashes = await Promise.all(
      backupCodes.map((code) => hashPassword(code)),
    )
    await user.save()

    return res.json({
      success: true,
      message: '2FA is on',
      // Shown once — only the hash is kept from here on.
      backupCodes,
    })
  } catch (error) {
    next(error)
  }
}

export const disableTwoFactor = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = disableTwoFactorSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({ success: false, message: 'Invalid request' })
    }

    const user = await User.findById(req.user?.id).select(
      '+totpSecret +totpBackupCodeHashes',
    )
    if (!user || !user.totpEnabled || !user.totpSecret) {
      return res.status(400).json({ success: false, message: '2FA is not on' })
    }

    const passwordValid = await verifyPassword(
      result.data.password,
      user.passwordHash,
    )
    if (!passwordValid) {
      return res.status(401).json({ success: false, message: 'Incorrect password' })
    }

    const codeValid =
      verifyTotp(result.data.code, user.totpSecret) ||
      (
        await Promise.all(
          user.totpBackupCodeHashes.map((hash) =>
            verifyPassword(result.data.code, hash),
          ),
        )
      ).some(Boolean)

    if (!codeValid) {
      return res.status(401).json({ success: false, message: 'Invalid code' })
    }

    user.totpEnabled = false
    user.totpSecret = null
    user.totpBackupCodeHashes = []
    await user.save()

    return res.json({ success: true, message: '2FA is off' })
  } catch (error) {
    next(error)
  }
}
