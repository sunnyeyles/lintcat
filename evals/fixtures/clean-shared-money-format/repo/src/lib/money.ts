/** Formats an amount in minor units for display, e.g. 129900 USD -> "$1,299.00". */
import { minorUnits } from "./currency.js";

export function formatMoney(amountMinor: number, currency: string): string {
  const exponent = minorUnits(currency);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(amountMinor / 10 ** exponent);
}
