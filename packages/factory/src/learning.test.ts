import { beforeEach, describe, expect, it } from "vitest";

import type { TaskContract } from "#src/contract";
import { buildLearningReport, learningReport, LESSON_TTL_DAYS, normaliseText, outputSignature } from "#src/learning";
import { loadRunHistory } from "#src/metrics";
import type { FactoryDatabase } from "#src/store/client";
import { listLessons } from "#src/store/lessons";
import { factoryCommands, factoryEvents, factoryRuns } from "#src/store/schema";
import { createTestFactoryDatabase } from "#src/store/test-store";

const T0 = new Date("2026-06-01T10:00:00Z");
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);

async function failedRun(
  database: FactoryDatabase,
  id: string,
  when: Date,
  options: { blocker: string; output?: string; category?: string; name?: string; repeated?: boolean; profile?: string },
) {
  await database.insert(factoryRuns).values({
    id,
    repoPath: "/repo",
    title: id,
    contract: {} as TaskContract,
    status: "failed",
    profile: options.profile ?? "quick",
    createdAt: when,
    finishedAt: when,
    blocker: options.blocker,
  });
  if (options.output !== undefined) {
    await database.insert(factoryCommands).values({
      runId: id,
      stage: "verify",
      name: options.name ?? "test",
      command: "node --test",
      cwd: "/workspace",
      startedAt: when,
      durationMs: 10,
      exitCode: options.category === "command_not_found" ? 127 : 1,
      timedOut: false,
      errorCategory: options.category ?? "nonzero_exit",
      outputHash: "h",
      output: options.output,
    });
  }
  if (options.repeated) await database.insert(factoryEvents).values({ runId: id, kind: "repeated_failure", stage: "verify", at: when });
}

const assertion = (path: string, line: number) =>
  `✖ greets\n  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 'hey' !== 'hello'\n    at ${path}:${line}:3`;

describe("learning report", () => {
  let database: FactoryDatabase;

  beforeEach(async () => {
    database = await createTestFactoryDatabase();
    const identical = "the same checks failed identically after repair: test";
    await failedRun(database, "r1", day(0), { blocker: identical, output: assertion("/tmp/a/test/greet.test.mjs", 12), repeated: true });
    await failedRun(database, "r2", day(1), { blocker: identical, output: assertion("/tmp/b/test/greet.test.mjs", 14), repeated: true });
    await failedRun(database, "r3", day(2), { blocker: identical, output: assertion("/tmp/c/test/greet.test.mjs", 9), repeated: true });
    const missing = "sh: 1: pnpm: not found";
    await failedRun(database, "r4", day(3), { blocker: "mandatory checks still failing after 2 repair pass(es): lint", output: missing, category: "command_not_found", name: "lint", profile: "bugfix" });
    await failedRun(database, "r5", day(4), { blocker: "mandatory checks still failing after 2 repair pass(es): lint", output: missing, category: "command_not_found", name: "lint" });
    await failedRun(database, "r6", day(4), { blocker: "dependency install failed (exit 1)" });
  });

  it("normalises the parts of a failure that vary between runs", () => {
    expect(outputSignature(assertion("/tmp/a/x.mjs", 1))).toBe(outputSignature(assertion("/var/b/y.mjs", 99)));
    expect(normaliseText("run r0abc12de3f4a5b6c at 1f2e3d4c failed")).toBe("run <run> at <hex> failed");
  });

  it("clusters recurring failures with evidence and tagged proposals, skipping one-offs", async () => {
    const report = buildLearningReport(await loadRunHistory(database), { now: day(5) });
    const labels = report.clusters.map((c) => `${c.source}:${c.label}:${c.runIds.join(",")}`);
    expect(labels).toEqual(
      expect.arrayContaining([
        "command:verify/test:r1,r2,r3",
        "repeated_failure:verify:r1,r2,r3",
        "blocker:blocker:r1,r2,r3",
        "command:verify/lint:r4,r5",
        "blocker:blocker:r4,r5",
      ]),
    );
    expect(report.clusters.some((c) => c.runIds.includes("r6"))).toBe(false);
    const missing = report.clusters.find((c) => c.label === "verify/lint")!;
    expect(missing.profiles).toEqual(["bugfix", "quick"]);
    expect(missing.candidates.map((c) => c.target)).toEqual(["sandbox", "tool"]);
    expect(missing.rootCause).toMatch(/sandbox image does not have/);
    const repeated = report.clusters.find((c) => c.source === "repeated_failure")!;
    expect(repeated.candidates[0]).toMatchObject({ target: "prompt" });
    expect(repeated.candidates[0]!.confidence).toBeGreaterThan(0);
    expect(repeated.candidates[0]!.confidence).toBeLessThan(1);
    const lesson = report.lessons.find((l) => l.key === `prompt:${repeated.key}`)!;
    expect(lesson).toMatchObject({ scope: "profile:quick", evidenceRunIds: ["r1", "r2", "r3"], occurrences: 3 });
    expect(lesson.expiresAt).toEqual(new Date(day(2).getTime() + LESSON_TTL_DAYS * 86_400_000));
  });

  it("upserts proposed lessons without duplicates, then expires and revives them", async () => {
    const first = await learningReport(database, {}, { now: day(5) });
    const stored = await listLessons(database);
    expect(stored).toHaveLength(first.lessons.length);
    expect(stored.every((l) => l.status === "proposed")).toBe(true);

    await learningReport(database, {}, { now: day(6) });
    expect(await listLessons(database)).toHaveLength(stored.length);

    const expired = await learningReport(database, {}, { now: day(60) });
    expect(expired.expired).toBe(stored.length);
    expect((await listLessons(database, { status: "retired" })).every((l) => l.retiredReason === "expired")).toBe(true);

    await failedRun(database, "r7", day(61), { blocker: "x", output: "sh: 1: pnpm: not found", category: "command_not_found", name: "lint" });
    await learningReport(database, {}, { now: day(62) });
    const revived = (await listLessons(database, { status: "proposed" })).filter((l) => l.evidenceRunIds.includes("r7"));
    expect(revived.map((l) => l.target).sort()).toEqual(["sandbox", "tool"]);
    expect(revived[0]!.evidenceRunIds).toEqual(["r4", "r5", "r7"]);
  });
});
