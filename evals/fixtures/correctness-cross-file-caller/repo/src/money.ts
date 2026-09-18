/** Amounts are integer cents everywhere; only the formatter sees a decimal point. */

/** Rounds half away from zero, the way the ledger does. */
export function percentOf(cents: number, percent: number): number {
  return Math.round((cents * percent) / 100);
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(Math.round(cents));
  const minor = String(absolute % 100).padStart(2, "0");
  return `${sign}${Math.floor(absolute / 100)}.${minor}`;
}
