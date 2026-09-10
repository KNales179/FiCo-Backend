import { Router } from 'express'
import { requireSpaceMember } from '../middleware/spaceAccess.js'
import {
  listElectricity,
  upsertElectricityForPayment,
} from '../controllers/electricityController.js'

/** Mounted at /:spaceId/electricity */
export const electricityRouter = Router({ mergeParams: true })
electricityRouter.get('/', requireSpaceMember('VIEWER'), listElectricity)

/** Mounted at /:spaceId/bill-payments */
export const billPaymentRouter = Router({ mergeParams: true })
billPaymentRouter.put(
  '/:paymentId/electricity',
  requireSpaceMember('EDITOR'),
  upsertElectricityForPayment,
)
