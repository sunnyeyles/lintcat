export function formatMoney(cents, currency) {
  const sign = cents < 0 ? "-" : "";
  return `${sign}${currency === "EUR" ? "€" : "$"}${(Math.abs(cents) / 100).toFixed(2)}`;
}
