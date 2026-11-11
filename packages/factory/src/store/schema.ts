import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type { TaskContract } from "#src/contract";

export const factoryRunStatus = pgEnum("factory_run_status", [
  "draft",
  "awaiting_approval",
  "queued",
  "running",
  "verifying",
  "delivered",
  "failed",
  "cancelled",
]);

export type FactoryRunStatus = (typeof factoryRunStatus.enumValues)[number];

export interface Checkpoint {
  stage: string;
  sha: string;
  nextStage: string;
  data?: Record<string, unknown>;
}

export interface RunOutcome {
  summary: string;
  branch?: string;
  pullRequestUrl?: string;
  checks?: { name: string; exitCode: number; passed: boolean }[];
  usage?: Record<string, number | null>;
}

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const factoryRuns = pgTable(
  "factory_runs",
  {
    id: text("id").primaryKey(),
    repoPath: text("repo_path").notNull(),
    title: text("title").notNull(),
    status: factoryRunStatus("status").notNull().default("draft"),
    stage: text("stage"),
    profile: text("profile"),
    workflowVersion: text("workflow_version"),
    contract: jsonb("contract").$type<TaskContract>().notNull(),
    contractHash: text("contract_hash"),
    baseSha: text("base_sha"),
    branch: text("branch"),
    worktreePath: text("worktree_path"),
    checkpoint: jsonb("checkpoint").$type<Checkpoint>(),
    agentSessionId: text("agent_session_id"),
    attempts: integer("attempts").notNull().default(0),
    recoveries: integer("recoveries").notNull().default(0),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    outcome: jsonb("outcome").$type<RunOutcome>(),
    blocker: text("blocker"),
    ...timestamps,
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("factory_runs_status_lease_idx").on(table.status, table.leaseExpiresAt)],
);

export const factoryEvents = pgTable(
  "factory_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => factoryRuns.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    kind: text("kind").notNull(),
    stage: text("stage"),
    agentId: text("agent_id"),
    workflowVersion: text("workflow_version"),
    promptVersion: text("prompt_version"),
    toolVersion: text("tool_version"),
    repositorySha: text("repository_sha"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [index("factory_events_run_idx").on(table.runId, table.id)],
);

export const factoryCommands = pgTable(
  "factory_commands",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => factoryRuns.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    name: text("name").notNull(),
    command: text("command").notNull(),
    cwd: text("cwd").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    exitCode: integer("exit_code").notNull(),
    timedOut: boolean("timed_out").notNull(),
    errorCategory: text("error_category"),
    outputHash: text("output_hash").notNull(),
    output: text("output").notNull(),
  },
  (table) => [index("factory_commands_run_idx").on(table.runId, table.id)],
);

export const factoryEffects = pgTable("factory_effects", {
  key: text("key").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => factoryRuns.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  result: jsonb("result").$type<unknown>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FactoryRun = typeof factoryRuns.$inferSelect;
export type FactoryEvent = typeof factoryEvents.$inferSelect;
export type FactoryCommand = typeof factoryCommands.$inferSelect;
export type FactoryEffect = typeof factoryEffects.$inferSelect;
