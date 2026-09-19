/** Turns a shipment into a priced quote from the published rate card. */
import { formatMoney, money } from "./money.js";
import { rateFor } from "./rate-card.js";

/** Half a kilo is the smallest billable weight step. */
const WEIGHT_STEP_GRAMS = 500;

export interface ShipmentRequest {
  carrier: string;
  zone: string;
  weightGrams: number;
}

export interface ShippingQuote {
  carrier: string;
  /** The amount due, already formatted, e.g. `$12.99`. */
  total: string;
  etaDays: number;
}

export async function quoteShipment(
  request: ShipmentRequest,
): Promise<ShippingQuote> {
  const rate = await rateFor(request.carrier, request.zone);
  const steps = Math.ceil(request.weightGrams / WEIGHT_STEP_GRAMS);
  const amountMinor = rate.baseMinor + steps * rate.perHalfKiloMinor;
  return {
    carrier: rate.carrier,
    total: formatMoney(money(amountMinor, rate.currency)),
    etaDays: rate.etaDays,
  };
}
