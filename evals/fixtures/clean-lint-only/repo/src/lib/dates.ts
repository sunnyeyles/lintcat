/** Formats an ISO timestamp as a calendar date for display, e.g. "Mar 4, 2025". */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(iso),
  );
}
