/** ISO 4217 minor-unit exponents for the currencies we bill in. */
const MINOR_UNITS: Readonly<Record<string, number>> = {
  EUR: 2,
  GBP: 2,
  JPY: 0,
  USD: 2,
};

export function minorUnits(currency: string): number {
  const units = MINOR_UNITS[currency];
  if (units === undefined) {
    throw new Error(`unsupported currency ${currency}`);
  }
  return units;
}
