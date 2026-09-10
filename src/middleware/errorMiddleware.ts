import { NextFunction, Request, Response } from 'express'

export const notFound = (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  })
}

interface MongoLikeError extends Error {
  name: string
  code?: number
  errors?: Record<string, unknown>
  keyValue?: Record<string, unknown>
}

export const errorHandler = (
  error: MongoLikeError,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  // Mongoose schema validation.
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Some values are not valid',
      errors: Object.keys(error.errors ?? {}),
    })
  }

  // Bad ObjectId / wrong type in a query.
  if (error.name === 'CastError') {
    return res
      .status(400)
      .json({ success: false, message: 'Malformed request' })
  }

  // Duplicate key (unique index).
  if (error.code === 11000) {
    const field = Object.keys(error.keyValue ?? {})[0]
    return res.status(409).json({
      success: false,
      message: field
        ? `That ${field} is already in use`
        : 'That value is already in use',
    })
  }

  console.error(error)

  res.status(500).json({
    success: false,
    message: 'Internal server error',
  })
}
