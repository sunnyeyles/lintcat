// Truncates fractional cents: 199.9 cents shows as $1.99.
export function formatPrice(cents) {
  return `$${(Math.floor(cents) / 100).toFixed(2)}`;
}

// Rounds to the nearest cent: 199.5 cents shows as $2.00.
export function formatPriceRounded(cents) {
  return `$${(Math.round(cents) / 100).toFixed(2)}`;
}
