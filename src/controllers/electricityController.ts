import { NextFunction, Response } from 'express'
import mongoose from 'mongoose'
import BillPayment from '../models/BillPayment.js'
import ElectricityRecord from '../models/ElectricityRecord.js'
import { SpaceRequest } from '../middleware/spaceAccess.js'
import { electricityDetailSchema } from '../validation/billValidation.js'
import { serializeElectricity } from '../services/electricityService.js'

/**
 * GET /api/spaces/:spaceId/electricity
 * Every electricity record for the space, newest billing period first, each
 * carrying a derived cost-per-kWh for comparison (Product Spec §16).
 */
export const listElectricity = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const records = await ElectricityRecord.find({
      spaceId: req.space!._id,
    }).sort({ billingPeriod: -1 })

    return res.json({
      success: true,
      records: records.map(serializeElectricity),
    })
  } catch (error) {
    next(error)
  }
}

/**
 * PUT /api/spaces/:spaceId/bill-payments/:paymentId/electricity
 * Attach or update the electricity detail for an already-recorded payment.
 */
export const upsertElectricityForPayment = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = electricityDetailSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid electricity data',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const paymentId = String(req.params.paymentId)
    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res
        .status(404)
        .json({ success: false, message: 'Payment not found' })
    }

    const payment = await BillPayment.findOne({
      _id: paymentId,
      spaceId: req.space!._id,
      deletedAt: null,
    })
    if (!payment) {
      return res
        .status(404)
        .json({ success: false, message: 'Payment not found' })
    }

    const e = result.data
    const record = await ElectricityRecord.findOneAndUpdate(
      { billPaymentId: payment._id },
      {
        $set: {
          spaceId: payment.spaceId,
          billId: payment.billId,
          billPaymentId: payment._id,
          billingPeriod: payment.periodKey,
          amountMinor: payment.amountMinor,
          consumptionKwh: e.consumptionKwh ?? null,
          energyChargeMinor: e.energyChargeMinor ?? null,
          transmissionMinor: e.transmissionMinor ?? null,
          distributionMinor: e.distributionMinor ?? null,
          taxesMinor: e.taxesMinor ?? null,
          otherChargesMinor: e.otherChargesMinor ?? null,
        },
      },
      { upsert: true, new: true },
    )

    return res.json({
      success: true,
      message: 'Electricity detail saved',
      electricity: serializeElectricity(record),
    })
  } catch (error) {
    next(error)
  }
}
