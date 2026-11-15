export function invoiceLine(item) {
  const sign = item.cents < 0 ? "-" : "";
  const amount = (Math.abs(item.cents) / 100).toFixed(2);
  return `${item.name}: ${sign}${item.currency === "EUR" ? "€" : "$"}${amount}`;
}

export function invoiceTotal(items) {
  const cents = items.reduce((sum, item) => sum + item.cents, 0);
  const sign = cents < 0 ? "-" : "";
  const amount = (Math.abs(cents) / 100).toFixed(2);
  return `Total: ${sign}${items[0]?.currency === "EUR" ? "€" : "$"}${amount}`;
}
