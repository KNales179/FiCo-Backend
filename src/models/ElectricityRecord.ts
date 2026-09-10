import mongoose, { Document, Schema } from 'mongoose'

export interface IElectricityRecord extends Document {
  spaceId: mongoose.Types.ObjectId
  billId: mongoose.Types.ObjectId
  billPaymentId: mongoose.Types.ObjectId
  /** e.g. "2026-03" — the billing month. */
  billingPeriod: string
  amountMinor: number
  consumptionKwh?: number | null
  energyChargeMinor?: number | null
  transmissionMinor?: number | null
  distributionMinor?: number | null
  taxesMinor?: number | null
  otherChargesMinor?: number | null
  createdAt: Date
  updatedAt: Date
}

const nonNegative = {
  type: Number,
  default: null,
  min: 0,
} as const

const electricityRecordSchema = new Schema<IElectricityRecord>(
  {
    spaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Space',
      required: true,
      index: true,
    },
    billId: {
      type: Schema.Types.ObjectId,
      ref: 'Bill',
      required: true,
      index: true,
    },
    billPaymentId: {
      type: Schema.Types.ObjectId,
      ref: 'BillPayment',
      required: true,
      unique: true,
    },
    billingPeriod: { type: String, required: true },
    amountMinor: { type: Number, required: true, min: 0 },
    consumptionKwh: nonNegative,
    energyChargeMinor: nonNegative,
    transmissionMinor: nonNegative,
    distributionMinor: nonNegative,
    taxesMinor: nonNegative,
    otherChargesMinor: nonNegative,
  },
  { timestamps: true },
)

const ElectricityRecord = mongoose.model<IElectricityRecord>(
  'ElectricityRecord',
  electricityRecordSchema,
)

export default ElectricityRecord
