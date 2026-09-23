import { lt, sql } from "drizzle-orm";

import type { Database } from "./client";
import { rateLimits } from "./schema";

export type RateLimitRule = { key: string; limit: number; windowMs: number; now: Date };
export type RateLimitResult = { allowed: boolean; count: number; resetAt: Date };

/** Counts one request against a fixed window, in a single statement so concurrent calls never share a count. */
export async function consumeRateLimit(
  database: Database,
  { key, limit, windowMs, now }: RateLimitRule,
): Promise<RateLimitResult> {
  const start = Math.floor(now.getTime() / windowMs) * windowMs;
  const [row] = await database
    .insert(rateLimits)
    .values({ key, windowStart: new Date(start), count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  const count = row?.count ?? 1;
  return { allowed: count <= limit, count, resetAt: new Date(start + windowMs) };
}

/** Deletes every window that started before `before`; returns how many. */
export async function pruneRateLimits(database: Database, before: Date): Promise<number> {
  const deleted = await database
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, before))
    .returning({ key: rateLimits.key });
  return deleted.length;
}
