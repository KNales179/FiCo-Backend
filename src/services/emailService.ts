/**
 * Transactional email via Brevo's HTTP API (https://api.brevo.com/v3/smtp/email).
 * A plain `fetch` call rather than their SDK — this is one JSON POST, not
 * worth a dependency for.
 */

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'
const SEND_TIMEOUT_MS = 10_000

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

interface SendEmailParams {
  to: string
  toName?: string | null
  subject: string
  htmlContent: string
}

/**
 * Sends one email. Throws if it can't be sent — callers that must not fail
 * the whole request over an email hiccup (registration, in particular)
 * catch and log rather than letting it propagate; callers where the email
 * *is* the point (forgot-password, resend-verification) let it surface.
 */
export const sendEmail = async (params: SendEmailParams): Promise<void> => {
  const apiKey = process.env.BREVO_API_KEY
  const senderEmail = process.env.BREVO_SENDER_EMAIL
  if (!apiKey || !senderEmail) {
    throw new Error('Email is not configured (BREVO_API_KEY / BREVO_SENDER_EMAIL)')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)

  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        sender: {
          email: senderEmail,
          name: process.env.BREVO_SENDER_NAME || 'Fico',
        },
        to: [{ email: params.to, name: params.toName || undefined }],
        subject: params.subject,
        htmlContent: params.htmlContent,
      }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Brevo send failed (${response.status}): ${body.slice(0, 300)}`)
    }
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('Brevo send failed')) {
      throw cause
    }
    throw new Error('Could not reach the email provider', { cause })
  } finally {
    clearTimeout(timer)
  }
}

const wrapper = (bodyHtml: string): string => `
  <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
    <h1 style="font-size: 20px; color: #863bff; margin: 0 0 16px;">Fico</h1>
    ${bodyHtml}
    <p style="margin-top: 32px; font-size: 12px; color: #888;">
      If you didn't request this, you can safely ignore this email.
    </p>
  </div>
`

export const sendVerificationEmail = async (
  to: string,
  toName: string,
  token: string,
): Promise<void> => {
  const link = `${FRONTEND_URL}/verify-email?token=${encodeURIComponent(token)}`
  await sendEmail({
    to,
    toName,
    subject: 'Confirm your email — Fico',
    htmlContent: wrapper(`
      <p>Hi ${toName},</p>
      <p>Confirm this is your email address to finish setting up your Fico account.</p>
      <p><a href="${link}" style="display:inline-block;background:#863bff;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;">Verify my email</a></p>
      <p style="font-size: 13px; color: #666;">This link expires in 24 hours.</p>
    `),
  })
}

export const sendPasswordResetEmail = async (
  to: string,
  toName: string,
  token: string,
): Promise<void> => {
  const link = `${FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`
  await sendEmail({
    to,
    toName,
    subject: 'Reset your password — Fico',
    htmlContent: wrapper(`
      <p>Hi ${toName},</p>
      <p>Someone asked to reset the password on this Fico account. If that was you, choose a new one here:</p>
      <p><a href="${link}" style="display:inline-block;background:#863bff;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;">Reset my password</a></p>
      <p style="font-size: 13px; color: #666;">This link expires in 1 hour, and works only once. Every device stays signed out until you sign back in with the new password.</p>
    `),
  })
}
