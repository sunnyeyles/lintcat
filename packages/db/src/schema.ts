import {
  bigint,
  boolean,
  integer,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const severityEnum = pgEnum("severity", ["low", "medium", "high"]);
export const accountTypeEnum = pgEnum("account_type", ["organization", "user"]);
export const membershipRoleEnum = pgEnum("membership_role", ["owner", "member"]);
export const repoPermissionEnum = pgEnum("repo_permission", [
  "admin",
  "maintain",
  "write",
  "triage",
  "read",
]);

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// One GitHub account; `slug` is its lowercased login and its subdomain.
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  githubAccountId: bigint("github_account_id", { mode: "number" }).notNull().unique(),
  accountType: accountTypeEnum("account_type").notNull(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  installationId: bigint("installation_id", { mode: "number" }).unique(),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  // Set on uninstall, which also clears installationId; the rows and history stay.
  uninstalledAt: timestamp("uninstalled_at", { withTimezone: true }),
  // SHA-256 hex of the ingest secret; the secret itself is never stored.
  ingestToken: text("ingest_token").unique(),
  createdAt: createdAt(),
});

// A slug the organization used before a GitHub rename; never also a live slug.
export const organizationSlugRedirects = pgTable("organization_slug_redirects", {
  slug: text("slug").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
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
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Null for a repo only ingest has seen; the installation webhook fills it in.
    githubRepoId: bigint("github_repo_id", { mode: "number" }).unique(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    private: boolean("private").notNull().default(false),
    // Set when the installation stops covering the repo; its reviews stay but are hidden.
    removedAt: timestamp("removed_at", { withTimezone: true }),
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
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    permission: repoPermissionEnum("permission").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("repo_access_user_repo_idx").on(t.userId, t.repoId)],
);

// The unique index is the ingest upsert's conflict target: one row per commit.
export const reviews = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    prNumber: integer("pr_number").notNull(),
    headSha: text("head_sha").notNull(),
    summary: text("summary").notNull(),
    durationMs: integer("duration_ms").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    cacheCreationInputTokens: integer("cache_creation_input_tokens")
      .notNull()
      .default(0),
    cacheReadInputTokens: integer("cache_read_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("reviews_repo_pr_head_sha_idx").on(t.repoId, t.prNumber, t.headSha),
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
export type Finding = typeof findings.$inferSelect;
export type NewFinding = typeof findings.$inferInsert;
