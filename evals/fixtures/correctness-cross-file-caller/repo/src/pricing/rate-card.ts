/** The published carrier rates, keyed by carrier and destination zone. */

export interface CarrierRate {
  carrier: string;
  currency: string;
  baseMinor: number;
  perHalfKiloMinor: number;
  etaDays: number;
}

const RATE_CARD = new Map<string, CarrierRate>([
  [
    "swiftpost:domestic",
    {
      carrier: "SwiftPost",
      currency: "USD",
      baseMinor: 499,
      perHalfKiloMinor: 120,
      etaDays: 2,
    },
  ],
  [
    "swiftpost:international",
    {
      carrier: "SwiftPost",
      currency: "USD",
      baseMinor: 1899,
      perHalfKiloMinor: 410,
      etaDays: 7,
    },
  ],
  [
    "harbourline:domestic",
    {
      carrier: "Harbourline",
      currency: "USD",
      baseMinor: 349,
      perHalfKiloMinor: 165,
      etaDays: 4,
    },
  ],
]);

export class UnknownRateError extends Error {
  constructor(carrier: string, zone: string) {
    super(`no published rate for ${carrier} to the ${zone} zone`);
    this.name = "UnknownRateError";
  }
}

/** Async because the rate card moves to the pricing service next quarter. */
export async function rateFor(
  carrier: string,
  zone: string,
): Promise<CarrierRate> {
  const rate = RATE_CARD.get(`${carrier.toLowerCase()}:${zone.toLowerCase()}`);
  if (rate === undefined) {
    throw new UnknownRateError(carrier, zone);
  }
  return rate;
}
