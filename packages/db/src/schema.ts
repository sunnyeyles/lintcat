import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { FileRole, LayerACoverage } from "@pr-review/index";

export const severityEnum = pgEnum("severity", ["low", "medium", "high"]);
export const roleEnum = pgEnum("role", ["owner", "admin", "member"]);
export const indexStatusEnum = pgEnum("index_status", [
  "building",
  "ready",
  "failed",
  "unsupported",
]);

const timestampNow = (name: string) =>
  timestamp(name, { withTimezone: true }).notNull().defaultNow();

const createdAt = () => timestampNow("created_at");

// `slug` is the subdomain: acme -> acme.<app-domain>.
export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  githubOrg: text("github_org"),
  createdAt: createdAt(),
});

// One team per user; teamId is null until the user creates or joins one.
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  githubId: integer("github_id").notNull().unique(),
  login: text("login").notNull(),
  name: text("name"),
  email: text("email"),
  avatarUrl: text("avatar_url"),
  teamId: integer("team_id").references(() => teams.id, {
    onDelete: "set null",
  }),
  role: roleEnum("role").notNull().default("member"),
  createdAt: createdAt(),
});

export const repos = pgTable(
  "repos",
  {
    id: serial("id").primaryKey(),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("repos_team_owner_name_idx").on(t.teamId, t.owner, t.name)],
);

export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  repoId: integer("repo_id")
    .notNull()
    .references(() => repos.id, { onDelete: "cascade" }),
  prNumber: integer("pr_number").notNull(),
  headSha: text("head_sha").notNull(),
  agents: text("agents").array().notNull(),
  summary: text("summary").notNull(),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: createdAt(),
});

// Per-agent leg of a review: the four token counters the logging events already carry.
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: serial("id").primaryKey(),
    reviewId: integer("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    agent: text("agent").notNull(),
    durationMs: integer("duration_ms").notNull(),
    findingCount: integer("finding_count").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    cacheCreationInputTokens: integer("cache_creation_input_tokens")
      .notNull()
      .default(0),
    cacheReadInputTokens: integer("cache_read_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
  },
  (t) => [uniqueIndex("agent_runs_review_agent_idx").on(t.reviewId, t.agent)],
);

// Mirrors reviewFindingSchema in @pr-review/schemas; keep the two in step.
export const findings = pgTable("findings", {
  id: serial("id").primaryKey(),
  reviewId: integer("review_id")
    .notNull()
    .references(() => reviews.id, { onDelete: "cascade" }),
  file: text("file").notNull(),
  line: integer("line"),
  category: text("category").notNull(),
  severity: severityEnum("severity").notNull(),
  title: text("title").notNull(),
  explanation: text("explanation").notNull(),
  suggestedFix: text("suggested_fix"),
  confidence: real("confidence").notNull(),
});

// A build fills a fresh index_id; current_index_id flips only once it succeeds.
export const indexBuilds = pgTable("index_builds", {
  id: serial("id").primaryKey(),
  repoId: integer("repo_id")
    .notNull()
    .references(() => repos.id, { onDelete: "cascade" }),
  sha: text("sha").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  coverage: jsonb("coverage").$type<LayerACoverage>().notNull(),
  builtAt: timestampNow("built_at"),
  buildMs: integer("build_ms").notNull().default(0),
});

export const repoIndex = pgTable("repo_index", {
  repoId: integer("repo_id")
    .primaryKey()
    .references(() => repos.id, { onDelete: "cascade" }),
  currentIndexId: integer("current_index_id").references(() => indexBuilds.id, {
    onDelete: "set null",
  }),
  status: indexStatusEnum("status").notNull().default("building"),
  defaultBranch: text("default_branch"),
  failureReason: text("failure_reason"),
  updatedAt: timestampNow("updated_at"),
});

export const indexPackages = pgTable("index_packages", {
  id: serial("id").primaryKey(),
  indexId: integer("index_id")
    .notNull()
    .references(() => indexBuilds.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  root: text("root").notNull(),
  entryPoints: text("entry_points").array().notNull(),
  dependsOn: text("depends_on").array().notNull(),
});

export const indexFiles = pgTable(
  "index_files",
  {
    id: serial("id").primaryKey(),
    indexId: integer("index_id")
      .notNull()
      .references(() => indexBuilds.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    packageId: integer("package_id").references(() => indexPackages.id, {
      onDelete: "cascade",
    }),
    role: text("role").$type<FileRole>().notNull(),
    language: text("language"),
    loc: integer("loc"),
    owners: text("owners").array().notNull(),
  },
  (t) => [uniqueIndex("index_files_index_path_idx").on(t.indexId, t.path)],
);

// Layer B: created now so the migration is one step, empty until the indexers land.
export const indexSymbols = pgTable(
  "index_symbols",
  {
    id: serial("id").primaryKey(),
    indexId: integer("index_id")
      .notNull()
      .references(() => indexBuilds.id, { onDelete: "cascade" }),
    fileId: integer("file_id")
      .notNull()
      .references(() => indexFiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    line: integer("line").notNull(),
    endLine: integer("end_line").notNull(),
    exported: boolean("exported").notNull().default(false),
  },
  (t) => [
    index("index_symbols_index_file_idx").on(t.indexId, t.fileId),
    index("index_symbols_index_name_idx").on(t.indexId, t.name),
  ],
);

// src/dst are file ids for "imports" and "tests", symbol ids otherwise; kind says which.
export const indexEdges = pgTable(
  "index_edges",
  {
    indexId: integer("index_id")
      .notNull()
      .references(() => indexBuilds.id, { onDelete: "cascade" }),
    src: integer("src").notNull(),
    dst: integer("dst").notNull(),
    kind: text("kind").notNull(),
    line: integer("line"),
  },
  (t) => [
    index("index_edges_index_src_kind_idx").on(t.indexId, t.src, t.kind),
    index("index_edges_index_dst_kind_idx").on(t.indexId, t.dst, t.kind),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type Repo = typeof repos.$inferSelect;
export type NewRepo = typeof repos.$inferInsert;
export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
export type Finding = typeof findings.$inferSelect;
export type NewFinding = typeof findings.$inferInsert;
export type IndexBuild = typeof indexBuilds.$inferSelect;
export type NewIndexBuild = typeof indexBuilds.$inferInsert;
export type RepoIndex = typeof repoIndex.$inferSelect;
export type NewRepoIndex = typeof repoIndex.$inferInsert;
export type IndexPackage = typeof indexPackages.$inferSelect;
export type NewIndexPackage = typeof indexPackages.$inferInsert;
export type IndexFile = typeof indexFiles.$inferSelect;
export type NewIndexFile = typeof indexFiles.$inferInsert;
export type IndexSymbol = typeof indexSymbols.$inferSelect;
export type NewIndexSymbol = typeof indexSymbols.$inferInsert;
export type IndexEdge = typeof indexEdges.$inferSelect;
export type NewIndexEdge = typeof indexEdges.$inferInsert;
