import { formatMoney } from "./money.mjs";

export function receipt(payment) {
  return `Paid ${formatMoney(payment.cents, payment.currency)} by ${payment.method}`;
}
