/** Formats an amount in cents for display, e.g. 129900 USD -> "$1,299.00". */
export function formatMoney(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    amountCents / 100,
  );
}
