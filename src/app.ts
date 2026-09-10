import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import { notFound, errorHandler } from './middleware/errorMiddleware.js'
import authRoutes from './routes/authRoutes.js'
import spaceRoutes from './routes/spaceRoutes.js'

const app = express()

// Behind a reverse proxy in production so rate-limiter / secure-cookie logic
// sees the real client IP and protocol.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1)
}

app.use(helmet())

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
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

app.use(notFound)
app.use(errorHandler)

export default app
