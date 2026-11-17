import { describe, expect, it } from "vitest";

import { elapsed, groupFactoryRuns, stageCast } from "@/app/dev/factory/board";
import type { LiveRunSummary } from "@/app/dev/run-trace/live-api";

const NOW = Date.parse("2026-11-17T12:00:00Z");

function run(runId: string, status: string, extra: Partial<LiveRunSummary> = {}): LiveRunSummary {
  return {
    runId,
    title: runId,
    format: "lintcat-factory",
    source: "factory",
    startedAt: "2026-11-17T11:00:00Z",
    lastSeenAt: "2026-11-17T11:30:00Z",
    status,
    ...extra,
  };
}

describe("groupFactoryRuns", () => {
  it("splits runs by status and ignores other sources", () => {
    const board = groupFactoryRuns(
      [
        run("a", "running", { stage: "implement", leaseExpiresAt: "2026-11-17T12:05:00Z" }),
        run("b", "verifying", { stage: "verify" }),
        run("c", "queued"),
        run("d", "awaiting_approval"),
        run("e", "delivered"),
        run("f", "failed"),
        { ...run("g", "running"), source: "push" },
      ],
      NOW,
    );
    expect(board.inProgress.map((r) => r.runId)).toEqual(["a", "b"]);
    expect(board.waiting.map((r) => r.runId)).toEqual(["c", "d"]);
    expect(board.finished.map((r) => r.runId)).toEqual(["e", "f"]);
    expect(board.inProgress.map((r) => r.cast)).toEqual(["implementer", "verify"]);
  });

  it("marks an active run with a lapsed lease as stalled", () => {
    const board = groupFactoryRuns([run("a", "running", { leaseExpiresAt: "2026-11-17T11:59:00Z" })], NOW);
    expect(board.inProgress[0]?.stalled).toBe(true);
  });

  it("keeps only the newest finished runs", () => {
    const runs = Array.from({ length: 25 }, (_, i) =>
      run(`r${i}`, "delivered", { lastSeenAt: new Date(NOW - i * 1000).toISOString() }),
    );
    const { finished } = groupFactoryRuns(runs, NOW);
    expect(finished).toHaveLength(20);
    expect(finished[0]?.runId).toBe("r0");
  });
});

describe("stageCast", () => {
  it("falls back to locate for stages without a character", () => {
    expect(stageCast("prepare")).toBe("locate");
    expect(stageCast(null)).toBe("locate");
    expect(stageCast("deliver")).toBe("deliver");
  });
});

describe("elapsed", () => {
  it("formats seconds, minutes and hours", () => {
    expect(elapsed("2026-11-17T11:59:30Z", NOW)).toBe("30s");
    expect(elapsed("2026-11-17T11:58:15Z", NOW)).toBe("1m 45s");
    expect(elapsed("2026-11-17T09:30:00Z", NOW)).toBe("2h 30m");
  });
});
