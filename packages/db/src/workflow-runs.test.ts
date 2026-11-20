import { asc } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { Database } from "./client";
import { organizations, repos, workflowJobs, workflowRuns } from "./schema";
import { createTestDatabase } from "./test-database";
import {
  pruneWorkflowRuns,
  upsertWorkflowJob,
  upsertWorkflowRun,
  type WorkflowJobInput,
  type WorkflowRunInput,
} from "./workflow-runs";

const STARTED = new Date("2026-11-01T12:00:00Z");

function at(seconds: number): Date {
  return new Date(STARTED.getTime() + seconds * 1000);
}

function run(overrides: Partial<WorkflowRunInput> = {}): WorkflowRunInput {
  return {
    githubRunId: 9_000_000_001,
    runAttempt: 1,
    workflowId: 7_000_000_001,
    workflowName: "CI",
    event: "pull_request",
    headBranch: "feature",
    headSha: "abc123",
    prNumber: 12,
    status: "queued",
    conclusion: null,
    runStartedAt: STARTED,
    githubUpdatedAt: at(0),
    htmlUrl: "https://github.com/acme/widgets/actions/runs/9000000001",
    ...overrides,
  };
}

function job(overrides: Partial<WorkflowJobInput> = {}): WorkflowJobInput {
  return {
    githubRunId: 9_000_000_001,
    runAttempt: 1,
    githubJobId: 8_000_000_001,
    name: "test",
    status: "queued",
    conclusion: null,
    startedAt: at(5),
    completedAt: null,
    runnerLabels: ["ubuntu-latest"],
    ...overrides,
  };
}

let database: Database;
let repoId: number;

beforeEach(async () => {
  database = await createTestDatabase();
  const [organization] = await database
    .insert(organizations)
    .values({ githubAccountId: 1, accountType: "organization", slug: "acme", name: "Acme" })
    .returning();
  const [repo] = await database
    .insert(repos)
    .values({ organizationId: organization!.id, owner: "acme", name: "widgets" })
    .returning();
  repoId = repo!.id;
});

const runs = () =>
  database
    .select({
      runAttempt: workflowRuns.runAttempt,
      status: workflowRuns.status,
      conclusion: workflowRuns.conclusion,
    })
    .from(workflowRuns)
    .orderBy(asc(workflowRuns.id));

const jobs = () =>
  database
    .select({ githubJobId: workflowJobs.githubJobId, status: workflowJobs.status })
    .from(workflowJobs)
    .orderBy(asc(workflowJobs.id));

describe("upsertWorkflowRun", () => {
  it("inserts a run, then moves it forward as GitHub updates it", async () => {
    expect(await upsertWorkflowRun(database, repoId, run())).toMatchObject({ repoId, status: "queued" });
    await upsertWorkflowRun(database, repoId, run({ status: "in_progress", githubUpdatedAt: at(10) }));
    await upsertWorkflowRun(
      database,
      repoId,
      run({ status: "completed", conclusion: "failure", githubUpdatedAt: at(60) }),
    );
    expect(await runs()).toEqual([{ runAttempt: 1, status: "completed", conclusion: "failure" }]);
  });

  it("ignores a redelivery and a stale event", async () => {
    await upsertWorkflowRun(
      database,
      repoId,
      run({ status: "completed", conclusion: "success", githubUpdatedAt: at(60) }),
    );
    expect(
      await upsertWorkflowRun(
        database,
        repoId,
        run({ status: "completed", conclusion: "success", githubUpdatedAt: at(60) }),
      ),
    ).toBeUndefined();
    expect(
      await upsertWorkflowRun(database, repoId, run({ status: "in_progress", githubUpdatedAt: at(10) })),
    ).toBeUndefined();
    expect(await runs()).toEqual([{ runAttempt: 1, status: "completed", conclusion: "success" }]);
  });

  it("completes a run updated within the same second", async () => {
    await upsertWorkflowRun(database, repoId, run({ status: "in_progress", githubUpdatedAt: at(10) }));
    await upsertWorkflowRun(
      database,
      repoId,
      run({ status: "completed", conclusion: "success", githubUpdatedAt: at(10) }),
    );
    expect(await runs()).toEqual([{ runAttempt: 1, status: "completed", conclusion: "success" }]);
  });

  it("stores a rerun as a new attempt row", async () => {
    await upsertWorkflowRun(database, repoId, run({ status: "completed", conclusion: "failure" }));
    await upsertWorkflowRun(database, repoId, run({ runAttempt: 2, githubUpdatedAt: at(120) }));
    expect(await runs()).toEqual([
      { runAttempt: 1, status: "completed", conclusion: "failure" },
      { runAttempt: 2, status: "queued", conclusion: null },
    ]);
  });
});

describe("upsertWorkflowJob", () => {
  it("skips a job whose run was never stored, and stores it once the run is", async () => {
    expect(await upsertWorkflowJob(database, repoId, job())).toBe("run_not_ingested");
    expect(await jobs()).toEqual([]);
    await upsertWorkflowRun(database, repoId, run());
    expect(await upsertWorkflowJob(database, repoId, job({ status: "in_progress" }))).toBe("stored");
    expect(await jobs()).toEqual([{ githubJobId: 8_000_000_001, status: "in_progress" }]);
  });

  it("skips a run in another repo", async () => {
    await upsertWorkflowRun(database, repoId, run());
    expect(await upsertWorkflowJob(database, repoId + 1, job())).toBe("run_not_ingested");
  });

  it("files a job under its own attempt", async () => {
    await upsertWorkflowRun(database, repoId, run());
    const second = await upsertWorkflowRun(database, repoId, run({ runAttempt: 2 }));
    await upsertWorkflowJob(database, repoId, job({ runAttempt: 2 }));
    const [stored] = await database.select().from(workflowJobs);
    expect(stored?.runId).toBe(second?.id);
  });

  it("never reopens a completed job", async () => {
    await upsertWorkflowRun(database, repoId, run());
    const done = job({ status: "completed", conclusion: "success", completedAt: at(30) });
    await upsertWorkflowJob(database, repoId, done);
    expect(await upsertWorkflowJob(database, repoId, job({ status: "in_progress" }))).toBe("stale");
    expect(await upsertWorkflowJob(database, repoId, done)).toBe("stale");
    const [stored] = await database.select().from(workflowJobs);
    expect(stored).toMatchObject({
      status: "completed",
      conclusion: "success",
      completedAt: at(30),
      runnerLabels: ["ubuntu-latest"],
    });
  });
});

describe("pruneWorkflowRuns", () => {
  it("deletes runs started before the cutoff, with their jobs", async () => {
    await upsertWorkflowRun(database, repoId, run());
    await upsertWorkflowJob(database, repoId, job());
    await upsertWorkflowRun(
      database,
      repoId,
      run({ githubRunId: 9_000_000_002, runStartedAt: at(3_600) }),
    );
    expect(await pruneWorkflowRuns(database, at(60))).toBe(1);
    expect(await database.select({ id: workflowRuns.githubRunId }).from(workflowRuns)).toEqual([
      { id: 9_000_000_002 },
    ]);
    expect(await jobs()).toEqual([]);
  });
});
