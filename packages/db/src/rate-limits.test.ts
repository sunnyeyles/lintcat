import { beforeEach, describe, expect, it } from "vitest";

import type { Database } from "./client";
import { consumeRateLimit, pruneRateLimits } from "./rate-limits";
import { rateLimits } from "./schema";
import { createTestDatabase } from "./test-database";

const HOUR = 3_600_000;
const NOON = new Date("2026-09-23T12:00:00Z");

function at(offsetMs: number): Date {
  return new Date(NOON.getTime() + offsetMs);
}

let database: Database;

beforeEach(async () => {
  database = await createTestDatabase();
});

describe("consumeRateLimit", () => {
  it("allows up to the limit in a window, then denies", async () => {
    const rule = { key: "ip:a", limit: 3, windowMs: HOUR };
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await consumeRateLimit(database, { ...rule, now: at(i * 60_000) }));
    }
    expect(results.map((r) => [r.allowed, r.count])).toEqual([
      [true, 1],
      [true, 2],
      [true, 3],
      [false, 4],
    ]);
    expect(results[3]?.resetAt).toEqual(at(HOUR));
  });

  it("starts counting again in the next window", async () => {
    const rule = { key: "ip:a", limit: 1, windowMs: HOUR };
    await consumeRateLimit(database, { ...rule, now: at(0) });
    expect((await consumeRateLimit(database, { ...rule, now: at(HOUR - 1) })).allowed).toBe(false);
    expect(await consumeRateLimit(database, { ...rule, now: at(HOUR) })).toEqual({
      allowed: true,
      count: 1,
      resetAt: at(2 * HOUR),
    });
  });

  it("counts each key on its own", async () => {
    const rule = { limit: 1, windowMs: HOUR, now: NOON };
    await consumeRateLimit(database, { ...rule, key: "ip:a" });
    expect((await consumeRateLimit(database, { ...rule, key: "ip:b" })).allowed).toBe(true);
  });

  it("gives concurrent requests distinct counts", async () => {
    const rule = { key: "ip:a", limit: 20, windowMs: HOUR, now: NOON };
    const results = await Promise.all(
      Array.from({ length: 20 }, () => consumeRateLimit(database, rule)),
    );
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });
});

describe("pruneRateLimits", () => {
  it("deletes only windows that started before the cutoff", async () => {
    await consumeRateLimit(database, { key: "ip:a", limit: 1, windowMs: HOUR, now: at(0) });
    await consumeRateLimit(database, { key: "ip:a", limit: 1, windowMs: HOUR, now: at(2 * HOUR) });
    expect(await pruneRateLimits(database, at(HOUR))).toBe(1);
    const left = await database.select({ windowStart: rateLimits.windowStart }).from(rateLimits);
    expect(left).toEqual([{ windowStart: at(2 * HOUR) }]);
  });
});
