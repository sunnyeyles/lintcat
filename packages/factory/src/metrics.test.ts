import { beforeEach, describe, expect, it } from "vitest";

import type { TaskContract } from "#src/contract";
import { percentile, profileMetrics } from "#src/metrics";
import type { FactoryDatabase } from "#src/store/client";
import { factoryCommands, factoryEvents, factoryRuns, type FactoryRunStatus } from "#src/store/schema";
import { createTestFactoryDatabase } from "#src/store/test-store";

const T0 = new Date("2026-06-01T10:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const pass = { results: [{ name: "test", exitCode: 0 }] };
const fail = { results: [{ name: "test", exitCode: 1 }] };

interface Seed {
  id: string;
  profile: string;
  status: FactoryRunStatus;
  seconds: number;
  cost?: number | null;
  blocker?: string;
  events?: [string, Record<string, unknown>?][];
  commands?: { exitCode: number; output?: string; name?: string; stage?: string; category?: string }[];
}

async function seed(database: FactoryDatabase, runs: Seed[]): Promise<void> {
  for (const run of runs) {
    await database.insert(factoryRuns).values({
      id: run.id,
      repoPath: "/repo",
      title: run.id,
      contract: {} as TaskContract,
      status: run.status,
      profile: run.profile,
      createdAt: at(-600),
      finishedAt: at(run.seconds),
      blocker: run.blocker ?? null,
      outcome: { summary: "", usage: { estimatedCostUsd: run.cost === undefined ? null : run.cost } },
    });
    const events: [string, Record<string, unknown>?][] = [["approved"], ["run_started"], ...(run.events ?? [])];
    for (const [index, [kind, data]] of events.entries()) {
      await database.insert(factoryEvents).values({ runId: run.id, kind, at: kind === "approved" ? at(-60) : at(index - 1), data: data ?? {} });
    }
    for (const [index, command] of (run.commands ?? []).entries()) {
      await database.insert(factoryCommands).values({
        runId: run.id,
        stage: command.stage ?? "verify",
        name: command.name ?? "test",
        command: "node --test",
        cwd: "/workspace",
        startedAt: at(index + 1),
        durationMs: 100,
        exitCode: command.exitCode,
        timedOut: false,
        errorCategory: command.category ?? (command.exitCode === 0 ? null : "nonzero_exit"),
        outputHash: "h",
        output: command.output ?? "",
      });
    }
  }
}

const SEEDED: Seed[] = [
  { id: "q1", profile: "quick", status: "delivered", seconds: 10, cost: 0.1, events: [["agent_finished"], ["checks_finished", pass], ["run_delivered"]], commands: [{ exitCode: 0 }] },
  {
    id: "q2",
    profile: "quick",
    status: "delivered",
    seconds: 30,
    cost: 0.3,
    events: [["agent_finished"], ["checks_finished", fail], ["repair_started"], ["agent_finished"], ["checks_finished", pass], ["run_delivered"]],
    commands: [{ exitCode: 1 }, { exitCode: 0 }],
  },
  {
    id: "q3",
    profile: "quick",
    status: "failed",
    seconds: 20,
    cost: null,
    blocker: "the same checks failed identically after repair: test",
    events: [["agent_finished"], ["checks_finished", fail], ["repair_started"], ["agent_finished"], ["checks_finished", fail], ["repeated_failure"], ["run_failed"]],
    commands: [{ exitCode: 1 }, { exitCode: 1 }],
  },
  { id: "q4", profile: "quick", status: "cancelled", seconds: 40, cost: 0, events: [["profile_escalated"], ["some_future_event", { x: 1 }], ["run_cancelled"]] },
  {
    id: "f1",
    profile: "refactor",
    status: "delivered",
    seconds: 5,
    cost: 0.5,
    events: [["baseline_recorded", pass], ["agent_finished"], ["checks_finished", fail], ["repair_started"], ["agent_finished"], ["checks_finished", pass], ["run_delivered"]],
    commands: [{ exitCode: 0 }, { exitCode: 1 }, { exitCode: 0 }],
  },
  { id: "b1", profile: "bugfix", status: "delivered", seconds: 5, events: [["bug_reproduced"]], commands: [{ exitCode: 1, stage: "reproduce" }, { exitCode: 0 }] },
];

describe("profile metrics", () => {
  let database: FactoryDatabase;

  beforeEach(async () => {
    database = await createTestFactoryDatabase();
    await seed(database, SEEDED);
    await database.insert(factoryRuns).values({ id: "pending", repoPath: "/repo", title: "p", contract: {} as TaskContract, status: "awaiting_approval", profile: "quick" });
  });

  it("computes exact rates, percentiles and costs per profile", async () => {
    const [bugfix, quick, refactor] = await profileMetrics(database);
    expect(bugfix).toMatchObject({ commands: 1, commandFailureRate: 0, otherEventKinds: {} });
    expect(quick).toMatchObject({
      profile: "quick",
      runs: 4,
      delivered: 2,
      failed: 1,
      cancelled: 1,
      verifiedDeliveryRate: 0.5,
      firstPassSuccessRate: 0.25,
      wallTimeMs: { median: 20_000, p95: 40_000 },
      commands: 5,
      commandFailureRate: 0.6,
      repeatedFailureRate: 0.5,
      repairSuccessRate: 0.5,
      testRegressionRate: null,
      agentRunsPerRun: 1.25,
      otherEventKinds: { some_future_event: 1 },
      escalationRate: 0.25,
    });
    expect(quick!.cost.estimatedUsd).toBeCloseTo(0.4);
    expect(quick!.cost.perVerifiedSuccessUsd).toBeCloseTo(0.2);
    expect(quick!.cost.runsWithoutCost).toBe(1);
    expect(refactor).toMatchObject({ profile: "refactor", runs: 1, testRegressionRate: 1, repairSuccessRate: 1, firstPassSuccessRate: 0 });
  });

  it("filters by repository", async () => {
    expect(await profileMetrics(database, { repoPath: "/elsewhere" })).toEqual([]);
  });

  it("uses nearest-rank percentiles", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
  });
});
