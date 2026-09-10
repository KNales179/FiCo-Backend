import { NextFunction, Response } from 'express'
import Membership, {
  IMembership,
  MembershipRole,
  ROLE_RANK,
} from '../models/Membership.js'
import Space, { ISpace } from '../models/Space.js'
import { AuthRequest } from './authMiddleware.js'

export interface SpaceRequest extends AuthRequest {
  space?: ISpace
  membership?: IMembership
}

/**
 * Gate for any route scoped to a space. Resolves `:spaceId`, confirms the
 * authenticated user has an ACTIVE membership of at least `minRole`, and
 * attaches `req.space` and `req.membership`.
 *
 * Enforced server-side on every space route — the frontend hiding an action is
 * never treated as security (Architecture §43, §45).
 */
export const requireSpaceMember =
  (minRole: MembershipRole = 'VIEWER') =>
  async (req: SpaceRequest, res: Response, next: NextFunction) => {
    try {
      const { spaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
        })
      }

      const space = await Space.findOne({
        _id: spaceId,
        deletedAt: null,
      }).catch(() => null)

      const membership = space
        ? await Membership.findOne({
            spaceId: space._id,
            userId,
            status: 'ACTIVE',
          })
        : null

      // Same 404 whether the space is missing or simply not visible to this
      // user, so ids can't be probed (Architecture §45).
      if (!space || !membership) {
        return res.status(404).json({
          success: false,
          message: 'Space not found',
        })
      }

      if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to do that in this space',
        })
      }

      req.space = space
      req.membership = membership
      next()
    } catch (error) {
      next(error)
    }
  }
