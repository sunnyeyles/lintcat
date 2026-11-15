import { formatMoney } from "./money.mjs";

export function invoiceLine(item) {
  return `${item.name}: ${formatMoney(item.cents, item.currency)}`;
}

export function invoiceTotal(items) {
  const cents = items.reduce((sum, item) => sum + item.cents, 0);
  return `Total: ${formatMoney(cents, items[0]?.currency)}`;
}
