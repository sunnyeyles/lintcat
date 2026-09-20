import type { Database } from "@pr-review/db";
import { createCapturingLogger, type CapturedLogEvent } from "@pr-review/logging";
import { describe, expect, it } from "vitest";

import { LOOKUP_CONCURRENCY, reconcile, type ReconcilePlan } from "@/lib/reconcile";

interface Trace {
  applied: number[];
  transactions: number;
  log: CapturedLogEvent[];
}

function run(
  candidates: readonly number[],
  lookup: (candidate: number) => Promise<number | undefined>,
  overrides: Partial<ReconcilePlan<number, number>> = {},
): { done: Promise<void>; trace: Trace } {
  const capturing = createCapturingLogger();
  const trace: Trace = { applied: [], transactions: 0, log: capturing.entries };
  const database = {
    async transaction(work: (tx: Database) => Promise<void>) {
      trace.transactions += 1;
      await work(database);
    },
  } as unknown as Database;

  const done = reconcile<number, number>({
    database,
    logger: capturing.logger,
    skippedEvent: "thing.skipped",
    candidates,
    fields: (candidate) => ({ candidate }),
    lookup,
    order: (resolved) => resolved,
    async apply(_database, resolved) {
      trace.applied.push(resolved);
    },
    ...overrides,
  });
  return { done, trace };
}

/** Resolves only when released, so a test can hold every lookup open at once. */
function gate() {
  const waiters: (() => void)[] = [];
  let inFlight = 0;
  let peak = 0;
  return {
    get inFlight() {
      return inFlight;
    },
    get peak() {
      return peak;
    },
    release() {
      const pending = waiters.splice(0);
      for (const resolve of pending) resolve();
      return Promise.resolve();
    },
    async hold<T>(value: T): Promise<T> {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => waiters.push(resolve));
      inFlight -= 1;
      return value;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("reconcile", () => {
  it("applies what resolved, in ascending order, inside one transaction", async () => {
    const { done, trace } = run([3, 1, 2], async (candidate) => candidate * 10);
    await done;

    expect(trace.applied).toEqual([10, 20, 30]);
    expect(trace.transactions).toBe(1);
  });

  it("writes nothing for a candidate whose lookup returns undefined", async () => {
    const { done, trace } = run([1, 2, 3], async (candidate) =>
      candidate === 2 ? undefined : candidate,
    );
    await done;

    expect(trace.applied).toEqual([1, 3]);
  });

  it("leaves stored state untouched for a failing lookup and logs it as skipped", async () => {
    const { done, trace } = run([1, 2, 3], async (candidate) => {
      if (candidate === 2) throw new Error("GitHub is down");
      return candidate;
    });
    await done;

    expect(trace.applied).toEqual([1, 3]);
    expect(trace.log).toEqual([
      {
        level: "error",
        event: "thing.skipped",
        candidate: 2,
        reason: "github_lookup_failed",
        error: "GitHub is down",
      },
    ]);
  });

  it("opens the transaction only after every lookup has resolved", async () => {
    const held = gate();
    const candidates = [1, 2, 3, 4];
    const { done, trace } = run(candidates, (candidate) => held.hold(candidate));

    await settle();
    expect(held.inFlight).toBe(candidates.length);
    expect(trace.transactions).toBe(0);

    await held.release();
    await done;

    expect(trace.transactions).toBe(1);
    expect(trace.applied).toEqual(candidates);
  });

  it("never runs more than LOOKUP_CONCURRENCY lookups at once", async () => {
    const held = gate();
    const tail = 3;
    const candidates = Array.from(
      { length: LOOKUP_CONCURRENCY * 2 + tail },
      (_, index) => index + 1,
    );
    const { done, trace } = run(candidates, (candidate) => held.hold(candidate));

    for (const expected of [LOOKUP_CONCURRENCY, LOOKUP_CONCURRENCY, tail]) {
      await settle();
      expect(held.inFlight).toBe(expected);
      expect(trace.transactions).toBe(0);
      await held.release();
    }
    await done;

    expect(held.peak).toBe(LOOKUP_CONCURRENCY);
    expect(trace.applied).toEqual(candidates);
  });
});
