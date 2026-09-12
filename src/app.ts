import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import { notFound, errorHandler } from './middleware/errorMiddleware.js'
import { requestLogger } from './middleware/requestLogger.js'
import authRoutes from './routes/authRoutes.js'
import spaceRoutes from './routes/spaceRoutes.js'
import adminRoutes from './routes/adminRoutes.js'
import pushRoutes from './routes/pushRoutes.js'
import feedbackRoutes from './routes/feedbackRoutes.js'

const app = express()

// Behind a reverse proxy in production so rate-limiter / secure-cookie logic
// sees the real client IP and protocol.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1)
}

app.use(helmet())
app.use(requestLogger)

// FRONTEND_URL accepts a comma-separated list — one deployed frontend is the
// common case, but a Vercel project alone often has more than one real
// origin (a production domain plus a preview-deployment URL, or an apex
// domain and its www), and each needs to be explicitly allow-listed since
// `cors` here reflects a specific origin rather than "*" (required anyway
// for cookies — credentials:true never works with a wildcard origin).
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

app.use(
  cors({
    origin: (origin, callback) => {
      // No Origin header at all (a same-origin request, curl, a health
      // check) — nothing to check against, let it through.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true)
      }
      callback(new Error('Not allowed by CORS'))
    },
    credentials: true,
  }),
)

app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))
app.use(cookieParser())

// Broad safety net on top of the tighter per-route limiters.
app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    limit: 240,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Slow down.' },
  }),
)

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    message: 'Fico API is running',
  })
})

app.use('/api/auth', authRoutes)
app.use('/api/spaces', spaceRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/push', pushRoutes)
app.use('/api/feedback', feedbackRoutes)

app.use(notFound)
app.use(errorHandler)

export default app
