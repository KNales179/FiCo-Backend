import { IElectricityRecord } from '../models/ElectricityRecord.js'

export const serializeElectricity = (r: IElectricityRecord) => {
  const costPerKwhMinor =
    r.consumptionKwh && r.consumptionKwh > 0
      ? Math.round(r.amountMinor / r.consumptionKwh)
      : null

  return {
    id: String(r._id),
    billId: String(r.billId),
    billPaymentId: String(r.billPaymentId),
    billingPeriod: r.billingPeriod,
    amountMinor: r.amountMinor,
    consumptionKwh: r.consumptionKwh ?? null,
    energyChargeMinor: r.energyChargeMinor ?? null,
    transmissionMinor: r.transmissionMinor ?? null,
    distributionMinor: r.distributionMinor ?? null,
    taxesMinor: r.taxesMinor ?? null,
    otherChargesMinor: r.otherChargesMinor ?? null,
    /** Derived: amount ÷ kWh, in minor units. Null when consumption is unknown. */
    costPerKwhMinor,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}
