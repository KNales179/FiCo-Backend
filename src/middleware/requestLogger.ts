import { NextFunction, Request, Response } from 'express'

/**
 * A deliberately basic access log — one line per request to stdout, no
 * external logging service, no log-shipping agent, no per-request cost.
 * Most hosting platforms (Render, Railway, Fly.io, a plain VPS with
 * `journalctl`, …) already capture and let you tail stdout for free; a
 * paid structured-logging service only earns its cost once there's an
 * actual need to search/alert across a volume of logs this app doesn't
 * have yet. `/api/health` is skipped so an uptime monitor polling every
 * few seconds doesn't drown out real traffic.
 */
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (req.path === '/api/health') return next()

  const start = process.hrtime.bigint()

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1_000_000
    console.log(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`,
    )
  })

  next()
}
