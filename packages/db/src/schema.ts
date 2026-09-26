import type {
  ReviewRecordChangedFile,
  ReviewRecordRisk,
} from "@pr-review/schemas";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
});

export const severityEnum = pgEnum("severity", ["low", "medium", "high"]);
export const accountTypeEnum = pgEnum("account_type", ["organization", "user"]);
export const membershipRoleEnum = pgEnum("membership_role", ["owner", "member"]);
export const reviewJobStatusEnum = pgEnum("review_job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "superseded",
]);
export const repoPermissionEnum = pgEnum("repo_permission", [
  "admin",
  "maintain",
  "write",
  "triage",
  "read",
]);
export const repoReviewModeEnum = pgEnum("repo_review_mode", [
  "off",
  "label",
  "every_pr",
]);

const tstz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => tstz("created_at").notNull().defaultNow();
const syncedAt = () => tstz("synced_at").notNull().defaultNow();
const updatedAt = () =>
  tstz("updated_at").notNull().defaultNow().$onUpdate(() => new Date());
const orgFk = () =>
  integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });
const userFk = () =>
  integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });
const repoFk = () =>
  integer("repo_id")
    .notNull()
    .references(() => repos.id, { onDelete: "cascade" });

// One GitHub account; `slug` is its lowercased login and its subdomain.
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  githubAccountId: bigint("github_account_id", { mode: "number" }).notNull().unique(),
  accountType: accountTypeEnum("account_type").notNull(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  installationId: bigint("installation_id", { mode: "number" }).unique(),
  suspendedAt: tstz("suspended_at"),
  // Set on uninstall, which also clears installationId; the rows and history stay.
  uninstalledAt: tstz("uninstalled_at"),
  createdAt: createdAt(),
});

// A slug the organization used before a GitHub rename; never also a live slug.
export const organizationSlugRedirects = pgTable("organization_slug_redirects", {
  slug: text("slug").primaryKey(),
  organizationId: orgFk(),
  createdAt: createdAt(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
  login: text("login").notNull(),
  name: text("name"),
  email: text("email"),
  avatarUrl: text("avatar_url"),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: serial("id").primaryKey(),
    userId: userFk(),
    organizationId: orgFk(),
    role: membershipRoleEnum("role").notNull(),
    syncedAt: syncedAt(),
  },
  (t) => [
    uniqueIndex("memberships_user_organization_idx").on(
      t.userId,
      t.organizationId,
    ),
  ],
);

export const repos = pgTable(
  "repos",
  {
    id: serial("id").primaryKey(),
    organizationId: orgFk(),
    // Null for a repo only ingest has seen; the installation webhook fills it in.
    githubRepoId: bigint("github_repo_id", { mode: "number" }).unique(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    private: boolean("private").notNull().default(false),
    // Set when the installation stops covering the repo; its reviews stay but are hidden.
    removedAt: tstz("removed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("repos_organization_owner_name_idx").on(
      t.organizationId,
      t.owner,
      t.name,
    ),
  ],
);

// A user's GitHub permission on a repo; no row means no access to a private repo.
export const repoAccess = pgTable(
  "repo_access",
  {
    id: serial("id").primaryKey(),
    userId: userFk(),
    repoId: repoFk(),
    permission: repoPermissionEnum("permission").notNull(),
    syncedAt: syncedAt(),
  },
  (t) => [uniqueIndex("repo_access_user_repo_idx").on(t.userId, t.repoId)],
);

// The unique index is the ingest upsert's conflict target: one row per commit.
export const reviews = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    repoId: repoFk(),
    prNumber: integer("pr_number").notNull(),
    headSha: text("head_sha").notNull(),
    // The pull request's base: which repository_graphs row this review reads.
    baseSha: text("base_sha"),
    changedFiles: jsonb("changed_files")
      .$type<ReviewRecordChangedFile[]>()
      .notNull()
      .default([]),
    summary: text("summary").notNull(),
    durationMs: integer("duration_ms").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    cacheCreationInputTokens: integer("cache_creation_input_tokens")
      .notNull()
      .default(0),
    cacheReadInputTokens: integer("cache_read_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    // Null for a review stored before risk scoring, or run with the index off.
    risk: jsonb("risk").$type<ReviewRecordRisk>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("reviews_repo_pr_head_sha_idx").on(t.repoId, t.prNumber, t.headSha),
  ],
);

// The repository index at one commit, gzipped JSON; reviews sharing a base share a row.
export const repositoryGraphs = pgTable(
  "repository_graphs",
  {
    id: serial("id").primaryKey(),
    repoId: repoFk(),
    baseSha: text("base_sha").notNull(),
    snapshot: bytea("snapshot").notNull(),
    fileCount: integer("file_count").notNull(),
    edgeCount: integer("edge_count").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("repository_graphs_repo_base_sha_idx").on(t.repoId, t.baseSha),
  ],
);

// The organization's own model key, sealed by secret-box; only `last4` is ever shown.
export const modelKeys = pgTable("model_keys", {
  id: serial("id").primaryKey(),
  organizationId: orgFk().unique(),
  provider: text("provider").notNull(),
  sealedKey: bytea("sealed_key").notNull(),
  last4: text("last4").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// One hosted review of a pull request at one head; the worker claims queued rows.
export const reviewJobs = pgTable(
  "review_jobs",
  {
    id: serial("id").primaryKey(),
    repoId: repoFk(),
    prNumber: integer("pr_number").notNull(),
    headSha: text("head_sha").notNull(),
    // X-GitHub-Delivery: a redelivered webhook carries the same id.
    deliveryId: text("delivery_id").unique(),
    status: reviewJobStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: tstz("run_after").notNull().defaultNow(),
    // A running job whose lease lapsed belongs to a dead worker and is claimable again.
    leaseExpiresAt: tstz("lease_expires_at"),
    lastError: text("last_error"),
    finishedAt: tstz("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("review_jobs_active_head_idx")
      .on(t.repoId, t.prNumber, t.headSha)
      .where(sql`${t.status} in ('queued', 'running')`),
    index("review_jobs_claim_idx").on(t.status, t.runAfter),
  ],
);

// A repo without a row reviews every pull request, on no model override, with fixes off.
export const repoSettings = pgTable("repo_settings", {
  id: serial("id").primaryKey(),
  repoId: repoFk().unique(),
  mode: repoReviewModeEnum("mode").notNull().default("every_pr"),
  // Model id override for the organization's key's provider; null uses the provider's default.
  model: text("model"),
  fixes: boolean("fixes").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Requests per key per fixed window; the key is a hash, never a raw address.
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: tstz("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    index("rate_limits_window_start_idx").on(t.windowStart),
  ],
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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type OrganizationSlugRedirect = typeof organizationSlugRedirects.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
export type MembershipRole = Membership["role"];
export type Repo = typeof repos.$inferSelect;
export type NewRepo = typeof repos.$inferInsert;
export type RepoAccess = typeof repoAccess.$inferSelect;
export type RepoPermission = RepoAccess["permission"];
export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
export type RepositoryGraph = typeof repositoryGraphs.$inferSelect;
export type NewRepositoryGraph = typeof repositoryGraphs.$inferInsert;
export type ModelKey = typeof modelKeys.$inferSelect;
export type ReviewJob = typeof reviewJobs.$inferSelect;
export type ReviewJobStatus = ReviewJob["status"];
export type RepoSettings = typeof repoSettings.$inferSelect;
export type RepoReviewMode = RepoSettings["mode"];
export type RateLimit = typeof rateLimits.$inferSelect;
export type Finding =typeof findings.$inferSelect;
export type NewFinding = typeof findings.$inferInsert;
