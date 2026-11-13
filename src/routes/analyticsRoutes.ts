import { NextFunction, Response, Router } from 'express'
import { requireSpaceMember } from '../middleware/spaceAccess.js'
import { SpaceRequest } from '../middleware/spaceAccess.js'
import {
  AnalyticsPeriod,
  computeSpaceAnalytics,
  resolveRange,
} from '../services/analyticsService.js'

const router = Router({ mergeParams: true })

const PERIODS: AnalyticsPeriod[] = [
  'THIS_MONTH',
  'LAST_MONTH',
  'THIS_YEAR',
  'LAST_YEAR',
  'ALL_TIME',
  'CUSTOM',
]

/** GET /api/spaces/:spaceId/analytics?period=&from=&to=&currency= */
router.get(
  '/',
  requireSpaceMember('VIEWER'),
  async (req: SpaceRequest, res: Response, next: NextFunction) => {
    try {
      const period = PERIODS.includes(req.query.period as AnalyticsPeriod)
        ? (req.query.period as AnalyticsPeriod)
        : 'THIS_MONTH'

      const custom =
        period === 'CUSTOM'
          ? {
              fromIso:
                typeof req.query.from === 'string'
                  ? new Date(req.query.from).toISOString()
                  : undefined,
              toIso:
                typeof req.query.to === 'string'
                  ? new Date(req.query.to).toISOString()
                  : undefined,
            }
          : undefined

      const currency =
        typeof req.query.currency === 'string'
          ? req.query.currency.toUpperCase()
          : 'PHP'

      const range = resolveRange(period, custom)
      const analytics = await computeSpaceAnalytics(
        req.space!._id,
        range,
        currency,
      )

      return res.json({ success: true, analytics })
    } catch (error) {
      next(error)
    }
  },
)

export default router
