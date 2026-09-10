import { NextFunction, Response } from 'express'
import mongoose from 'mongoose'
import Account from '../models/Account.js'
import Bill, { IBill } from '../models/Bill.js'
import BillPayment, { IBillPayment } from '../models/BillPayment.js'
import ElectricityRecord from '../models/ElectricityRecord.js'
import Transaction from '../models/Transaction.js'
import { SpaceRequest } from '../middleware/spaceAccess.js'
import { serializeElectricity } from '../services/electricityService.js'
import { advanceDueDate, periodKey } from '../utils/recurrence.js'
import {
  createBillSchema,
  payBillSchema,
  updateBillSchema,
} from '../validation/billValidation.js'

const serializeBill = (bill: IBill) => ({
  id: String(bill._id),
  spaceId: String(bill.spaceId),
  name: bill.name,
  recurrence: bill.recurrence,
  billType: bill.billType,
  expectedAmountMinor: bill.expectedAmountMinor ?? null,
  nextDueDate: bill.nextDueDate,
  categoryName: bill.categoryName ?? null,
  paymentAccountId: bill.paymentAccountId
    ? String(bill.paymentAccountId)
    : null,
  active: bill.active,
  tracksElectricity: bill.tracksElectricity,
  createdAt: bill.createdAt,
  updatedAt: bill.updatedAt,
})

const serializePayment = (p: IBillPayment) => ({
  id: String(p._id),
  billId: String(p.billId),
  amountMinor: p.amountMinor,
  paidAt: p.paidAt,
  periodKey: p.periodKey,
  accountId: String(p.accountId),
  transactionId: p.transactionId ? String(p.transactionId) : null,
  createdAt: p.createdAt,
})

const loadBill = async (
  spaceId: mongoose.Types.ObjectId,
  billIdParam: string | string[],
) => {
  const billId = String(billIdParam)
  if (!mongoose.Types.ObjectId.isValid(billId)) return null
  return Bill.findOne({ _id: billId, spaceId, deletedAt: null })
}

/** GET /api/spaces/:spaceId/bills  (?upcomingBefore=ISO for the upcoming view) */
export const listBills = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const filter: Record<string, unknown> = {
      spaceId: req.space!._id,
      deletedAt: null,
    }
    if (req.query.active === 'true') filter.active = true
    if (typeof req.query.upcomingBefore === 'string') {
      filter.active = true
      filter.nextDueDate = { $lte: new Date(req.query.upcomingBefore) }
    }

    const bills = await Bill.find(filter).sort({ nextDueDate: 1 })
    return res.json({
      success: true,
      bills: bills.map(serializeBill),
    })
  } catch (error) {
    next(error)
  }
}

/** POST /api/spaces/:spaceId/bills */
export const createBill = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = createBillSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid bill data',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const bill = await Bill.create({
      spaceId: req.space!._id,
      name: result.data.name,
      recurrence: result.data.recurrence,
      billType: result.data.billType,
      expectedAmountMinor: result.data.expectedAmountMinor ?? null,
      nextDueDate: new Date(result.data.nextDueDate),
      categoryName: result.data.categoryName ?? null,
      paymentAccountId: result.data.paymentAccountId ?? null,
      active: true,
      tracksElectricity: result.data.tracksElectricity ?? false,
      createdBy: req.user!.id,
    })

    return res.status(201).json({
      success: true,
      message: 'Bill created',
      bill: serializeBill(bill),
    })
  } catch (error) {
    next(error)
  }
}

/** GET /api/spaces/:spaceId/bills/:billId */
export const getBill = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const bill = await loadBill(req.space!._id, req.params.billId)
    if (!bill) {
      return res
        .status(404)
        .json({ success: false, message: 'Bill not found' })
    }
    const payments = await BillPayment.find({
      billId: bill._id,
      deletedAt: null,
    }).sort({ paidAt: -1 })

    return res.json({
      success: true,
      bill: serializeBill(bill),
      payments: payments.map(serializePayment),
    })
  } catch (error) {
    next(error)
  }
}

/** PATCH /api/spaces/:spaceId/bills/:billId */
export const updateBill = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = updateBillSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid bill data',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const bill = await loadBill(req.space!._id, req.params.billId)
    if (!bill) {
      return res
        .status(404)
        .json({ success: false, message: 'Bill not found' })
    }

    const d = result.data
    if (d.name !== undefined) bill.name = d.name
    if (d.recurrence !== undefined) bill.recurrence = d.recurrence
    if (d.billType !== undefined) bill.billType = d.billType
    if (d.expectedAmountMinor !== undefined) {
      bill.expectedAmountMinor = d.expectedAmountMinor
    }
    if (d.nextDueDate !== undefined) {
      bill.nextDueDate = new Date(d.nextDueDate)
    }
    if (d.categoryName !== undefined) bill.categoryName = d.categoryName
    if (d.paymentAccountId !== undefined) {
      bill.paymentAccountId = d.paymentAccountId
        ? new mongoose.Types.ObjectId(d.paymentAccountId)
        : null
    }
    if (d.active !== undefined) bill.active = d.active
    if (d.tracksElectricity !== undefined) {
      bill.tracksElectricity = d.tracksElectricity
    }

    await bill.save()
    return res.json({
      success: true,
      message: 'Bill updated',
      bill: serializeBill(bill),
    })
  } catch (error) {
    next(error)
  }
}

/** DELETE /api/spaces/:spaceId/bills/:billId — soft delete (payment history kept). */
export const deleteBill = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const bill = await loadBill(req.space!._id, req.params.billId)
    if (!bill) {
      return res
        .status(404)
        .json({ success: false, message: 'Bill not found' })
    }
    bill.deletedAt = new Date()
    bill.active = false
    await bill.save()
    return res.json({ success: true, message: 'Bill deleted' })
  } catch (error) {
    next(error)
  }
}

/**
 * POST /api/spaces/:spaceId/bills/:billId/pay
 * body: { amountMinor, accountId?, paidAt? }
 *
 * Records the payment, creates the linked EXPENSE, and advances the bill to its
 * next occurrence. The current occurrence can only be paid once — a second
 * attempt returns 409 (Product Spec §14, Roadmap Phase 11).
 */
export const payBill = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = payBillSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment',
        errors: result.error.flatten().fieldErrors,
      })
    }

    const spaceId = req.space!._id
    const bill = await loadBill(spaceId, req.params.billId)
    if (!bill) {
      return res
        .status(404)
        .json({ success: false, message: 'Bill not found' })
    }

    const requestedAccountId =
      result.data.accountId ??
      (bill.paymentAccountId ? String(bill.paymentAccountId) : null)

    const account = requestedAccountId
      ? await Account.findOne({
          _id: mongoose.Types.ObjectId.isValid(requestedAccountId)
            ? requestedAccountId
            : null,
          spaceId,
          deletedAt: null,
          status: 'ACTIVE',
        })
      : ((await Account.findOne({
          spaceId,
          deletedAt: null,
          status: 'ACTIVE',
          isDefault: true,
        })) ??
        (await Account.findOne({
          spaceId,
          deletedAt: null,
          status: 'ACTIVE',
        })))

    if (!account) {
      return res.status(422).json({
        success: false,
        message: 'Choose an active account to pay from',
      })
    }

    const key = periodKey(bill.nextDueDate, bill.recurrence)

    const existing = await BillPayment.findOne({
      billId: bill._id,
      periodKey: key,
    })
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'This bill period has already been paid',
      })
    }

    const paidAt = result.data.paidAt
      ? new Date(result.data.paidAt)
      : new Date()

    const txn = await Transaction.create({
      spaceId,
      type: 'EXPENSE',
      amountMinor: result.data.amountMinor,
      currency: account.currency,
      title: bill.name,
      categoryName: bill.categoryName ?? null,
      accountId: account._id,
      occurredAt: paidAt,
      sourceType: 'BILL_PAYMENT',
      sourceId: String(bill._id),
      createdBy: req.user!.id,
    })

    let payment: IBillPayment
    try {
      payment = await BillPayment.create({
        spaceId,
        billId: bill._id,
        amountMinor: result.data.amountMinor,
        paidAt,
        periodKey: key,
        accountId: account._id,
        transactionId: txn._id,
        createdBy: req.user!.id,
      })
    } catch (err) {
      // Lost the race on the unique (billId, periodKey) index.
      await Transaction.deleteOne({ _id: txn._id })
      return res.status(409).json({
        success: false,
        message: 'This bill period has already been paid',
      })
    }

    let electricity = null
    if (bill.tracksElectricity && result.data.electricity) {
      const e = result.data.electricity
      const record = await ElectricityRecord.create({
        spaceId,
        billId: bill._id,
        billPaymentId: payment._id,
        billingPeriod: key,
        amountMinor: result.data.amountMinor,
        consumptionKwh: e.consumptionKwh ?? null,
        energyChargeMinor: e.energyChargeMinor ?? null,
        transmissionMinor: e.transmissionMinor ?? null,
        distributionMinor: e.distributionMinor ?? null,
        taxesMinor: e.taxesMinor ?? null,
        otherChargesMinor: e.otherChargesMinor ?? null,
      })
      electricity = serializeElectricity(record)
    }

    bill.nextDueDate = advanceDueDate(bill.nextDueDate, bill.recurrence)
    if (bill.billType === 'FIXED') {
      bill.expectedAmountMinor = result.data.amountMinor
    }
    await bill.save()

    return res.status(201).json({
      success: true,
      message: 'Bill paid',
      bill: serializeBill(bill),
      payment: serializePayment(payment),
      electricity,
    })
  } catch (error) {
    next(error)
  }
}

/** GET /api/spaces/:spaceId/bills/:billId/payments */
export const listBillPayments = async (
  req: SpaceRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const bill = await loadBill(req.space!._id, req.params.billId)
    if (!bill) {
      return res
        .status(404)
        .json({ success: false, message: 'Bill not found' })
    }
    const payments = await BillPayment.find({
      billId: bill._id,
      deletedAt: null,
    }).sort({ paidAt: -1 })

    return res.json({
      success: true,
      payments: payments.map(serializePayment),
    })
  } catch (error) {
    next(error)
  }
}
