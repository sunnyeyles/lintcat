/** Formats a ratio for display, e.g. 0.015 -> "1.5%". */
export function formatPercent(ratio: number): string {
  return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 }).format(
    ratio,
  );
}
