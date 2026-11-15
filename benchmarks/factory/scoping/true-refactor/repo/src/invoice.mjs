import { formatPriceRounded } from "./prices.mjs";

export function invoiceTotal(lines) {
  const cents = lines.reduce((sum, line) => sum + line.cents, 0);
  return `Total: ${formatPriceRounded(cents)}`;
}
