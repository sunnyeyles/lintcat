/** Due-date arithmetic. Dates are ISO strings in UTC. */
const DAY_MS = 24 * 60 * 60 * 1000;

export function daysOverdue(dueAt: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(dueAt)) / DAY_MS));
}

export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";

export function agingBucket(dueAt: string, now: Date): AgingBucket {
  const days = Math.floor((now.getTime() - Date.parse(dueAt)) / DAY_MS);
  if (days <= 0) {
    return "current";
  }
  if (days <= 30) {
    return "1-30";
  }
  if (days <= 60) {
    return "31-60";
  }
  return days <= 90 ? "61-90" : "90+";
}
