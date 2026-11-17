import { describe, expect, it } from "vitest";

import { isLive, type LiveRunSummary } from "@/app/dev/run-trace/live-api";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const run: LiveRunSummary = {
  runId: "r",
  title: null,
  format: null,
  source: "push",
  startedAt: "2026-11-17T11:00:00Z",
  lastSeenAt: "2026-11-17T11:50:00Z",
};

describe("isLive", () => {
  it("uses the last-seen window when the run has no status", () => {
    expect(isLive(run, NOW)).toBe(false);
    expect(isLive({ ...run, lastSeenAt: "2026-11-17T11:59:30Z" }, NOW)).toBe(true);
  });

  it("trusts a status over silence", () => {
    expect(isLive({ ...run, status: "running" }, NOW)).toBe(true);
    expect(isLive({ ...run, status: "delivered", lastSeenAt: "2026-11-17T11:59:59Z" }, NOW)).toBe(false);
  });
});
