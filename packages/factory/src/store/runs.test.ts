import { beforeEach, describe, expect, it } from "vitest";

import type { TaskContract } from "#src/contract";
import type { FactoryDatabase } from "#src/store/client";
import {
  appendEvent,
  approveRun,
  claimRun,
  createRun,
  findEffect,
  getRun,
  listEvents,
  listRuns,
  profileSummary,
  recordEffect,
  renewLease,
  requestCancel,
  saveProgress,
  settleRun,
  updateDraft,
} from "#src/store/runs";
import { createTestFactoryDatabase } from "#src/store/test-store";

const LEASE = { leaseMs: 60_000 };
const contract = { contractVersion: 1, taskId: "t" } as unknown as TaskContract;
const approval = { profile: "quick", workflowVersion: "v1", contractHash: "h", baseSha: "a".repeat(40) };

let database: FactoryDatabase;

beforeEach(async () => {
  database = await createTestFactoryDatabase();
});

async function queued(id: string) {
  await createRun(database, { id, repoPath: "/repo", title: id, contract });
  expect(await approveRun(database, id, contract, approval)).toBe(true);
}

describe("run lifecycle", () => {
  it("creates, approves and claims a run", async () => {
    const run = await createRun(database, { id: "r1", repoPath: "/repo", title: "t", contract });
    expect(run).toMatchObject({ status: "draft", attempts: 0, cancelRequested: false });
    expect(await updateDraft(database, "r1", { contract, title: "t2", status: "awaiting_approval" }))
      .toMatchObject({ title: "t2", status: "awaiting_approval" });
    expect(await approveRun(database, "r1", contract, approval)).toBe(true);
    expect(await approveRun(database, "r1", contract, approval)).toBe(false);
    expect(await updateDraft(database, "r1", { contract, title: "x", status: "draft" })).toBeUndefined();

    const claimed = await claimRun(database, LEASE);
    expect(claimed).toMatchObject({ id: "r1", status: "running", attempts: 1, profile: "quick" });
    expect(claimed?.leaseExpiresAt).toBeInstanceOf(Date);
    expect(await claimRun(database, LEASE)).toBeUndefined();
  });

  it("never hands one run to two concurrent claims", async () => {
    await queued("a");
    await queued("b");
    const claims = await Promise.all([1, 2, 3].map(() => claimRun(database, LEASE)));
    const ids = claims.filter((c) => c).map((c) => c!.id);
    expect(ids.sort()).toEqual(["a", "b"]);
  });

  it("claims only the named run when given one", async () => {
    await queued("a");
    await queued("b");
    expect((await claimRun(database, { ...LEASE, runId: "b" }))?.id).toBe("b");
  });

  it("reclaims a run whose lease lapsed and counts the attempt", async () => {
    await queued("a");
    await claimRun(database, { leaseMs: -1_000 });
    await saveProgress(database, "a", { status: "verifying", stage: "verify" });
    const reclaimed = await claimRun(database, LEASE);
    expect(reclaimed).toMatchObject({ id: "a", status: "running", attempts: 2, stage: "verify" });
    expect(await claimRun(database, LEASE)).toBeUndefined();
  });

  it("reports a cancel request through renewLease", async () => {
    await queued("a");
    await claimRun(database, LEASE);
    expect(await renewLease(database, "a", 60_000)).toEqual({ alive: true, cancelRequested: false });
    expect(await requestCancel(database, "a")).toBe("requested");
    expect(await renewLease(database, "a", 60_000)).toEqual({ alive: true, cancelRequested: true });
    expect(await settleRun(database, "a", { status: "cancelled", outcome: { summary: "stop" } })).toBe(true);
    expect(await renewLease(database, "a", 60_000)).toEqual({ alive: false, cancelRequested: true });
    expect(await requestCancel(database, "a")).toBe("finished");
  });

  it("cancels a queued run at once so no runner claims it", async () => {
    await queued("a");
    expect(await requestCancel(database, "a")).toBe("cancelled");
    expect(await claimRun(database, LEASE)).toBeUndefined();
    expect((await getRun(database, "a"))?.status).toBe("cancelled");
    expect(await requestCancel(database, "missing")).toBe("missing");
  });

  it("settles a run only once", async () => {
    await queued("a");
    await claimRun(database, LEASE);
    const outcome = { summary: "done", branch: "factory/a" };
    expect(await settleRun(database, "a", { status: "delivered", outcome })).toBe(true);
    expect(await settleRun(database, "a", { status: "failed", outcome, blocker: "x" })).toBe(false);
    const run = await getRun(database, "a");
    expect(run).toMatchObject({ status: "delivered", outcome, leaseExpiresAt: null });
    expect(run?.finishedAt).toBeInstanceOf(Date);
    expect(await saveProgress(database, "a", { stage: "late" })).toBe(false);
  });

  it("lists runs newest first and summarises by profile", async () => {
    await queued("a");
    await queued("b");
    await claimRun(database, { ...LEASE, runId: "a" });
    await settleRun(database, "a", { status: "delivered", outcome: { summary: "ok" } });
    expect((await listRuns(database, { limit: 10 })).map((r) => r.id)).toEqual(["b", "a"]);
    expect(await profileSummary(database)).toEqual([
      expect.objectContaining({ profile: "quick", runs: 2, delivered: 1, failed: 0, cancelled: 0 }),
    ]);
  });
});

describe("effects and events", () => {
  it("keeps the first result for an effect key", async () => {
    await queued("a");
    const first = await recordEffect(database, { key: "push:a", runId: "a", kind: "push", result: { sha: "1" } });
    const again = await recordEffect(database, { key: "push:a", runId: "a", kind: "push", result: { sha: "2" } });
    expect(again).toEqual(first);
    expect((await findEffect(database, "push:a"))?.result).toEqual({ sha: "1" });
    expect(await findEffect(database, "push:b")).toBeUndefined();
  });

  it("returns events in insertion order after a cursor", async () => {
    await queued("a");
    const one = await appendEvent(database, { runId: "a", kind: "stage.start", stage: "plan" });
    await appendEvent(database, { runId: "a", kind: "stage.end", data: { ok: true } });
    await appendEvent(database, { runId: "a", kind: "done" });
    expect((await listEvents(database, "a")).map((e) => e.kind)).toEqual(["stage.start", "stage.end", "done"]);
    const after = await listEvents(database, "a", { afterId: one.id });
    expect(after.map((e) => e.kind)).toEqual(["stage.end", "done"]);
    expect(one.data).toEqual({});
  });
});
