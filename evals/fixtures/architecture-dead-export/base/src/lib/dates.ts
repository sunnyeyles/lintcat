/** Due-date arithmetic. Dates are ISO strings in UTC. */
const DAY_MS = 24 * 60 * 60 * 1000;

export function daysOverdue(dueAt: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(dueAt)) / DAY_MS));
}
