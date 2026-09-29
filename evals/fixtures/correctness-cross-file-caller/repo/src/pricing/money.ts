/** Amounts of money, held in minor units so nothing rounds twice. */

export interface Money {
  amountMinor: number;
  currency: string;
}

export function money(amountMinor: number, currency: string): Money {
  return { amountMinor: Math.round(amountMinor), currency };
}

const SYMBOLS = new Map<string, string>([
  ["USD", "$"],
  ["EUR", "€"],
  ["GBP", "£"],
]);

/** The display form, e.g. `$12.99`. */
export function formatMoney(value: Money): string {
  const symbol = SYMBOLS.get(value.currency) ?? `${value.currency} `;
  const major = Math.floor(value.amountMinor / 100);
  const minor = String(value.amountMinor % 100).padStart(2, "0");
  return `${symbol}${major}.${minor}`;
}

export function addMoney(left: Money, right: Money): Money {
  if (left.currency !== right.currency) {
    throw new Error(
      `cannot add ${left.currency} to ${right.currency} without a rate`,
    );
  }
  return money(left.amountMinor + right.amountMinor, left.currency);
}
