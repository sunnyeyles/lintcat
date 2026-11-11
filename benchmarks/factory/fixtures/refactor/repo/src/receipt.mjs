export function receipt(payment) {
  const sign = payment.cents < 0 ? "-" : "";
  const amount = (Math.abs(payment.cents) / 100).toFixed(2);
  return `Paid ${sign}${payment.currency === "EUR" ? "€" : "$"}${amount} by ${payment.method}`;
}
