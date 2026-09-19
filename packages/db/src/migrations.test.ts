import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import type { Database } from "./client";
import { memberships, organizations, repoAccess, repos, users } from "./schema";
import { createTestDatabase } from "./test-database";

let database: Database;

beforeAll(async () => {
  database = await createTestDatabase();
});

async function columns(table: string): Promise<string[]> {
  // The driver-agnostic Database types execute()'s result as unknown.
  const result = (await database.execute(
    sql`select column_name from information_schema.columns where table_name = ${table} order by column_name`,
  )) as { rows: { column_name: string }[] };
  return result.rows.map((row) => row.column_name);
}

describe("migrations applied in order to an empty database", () => {
  it("give reviews its duration once and no token columns", async () => {
    expect(await columns("reviews")).toEqual([
      "agents",
      "created_at",
      "duration_ms",
      "head_sha",
      "id",
      "pr_number",
      "repo_id",
      "summary",
    ]);
  });

  it("add the ingest token, the finding's agent and agent_runs", async () => {
    expect(await columns("organizations")).toContain("ingest_token");
    expect(await columns("findings")).toContain("agent");
    expect(await columns("agent_runs")).toEqual([
      "agent",
      "cache_creation_input_tokens",
      "cache_read_input_tokens",
      "duration_ms",
      "finding_count",
      "id",
      "input_tokens",
      "output_tokens",
      "review_id",
    ]);
  });

  it("replace teams with organizations and memberships", async () => {
    expect(await columns("teams")).toEqual([]);
    expect(await columns("organizations")).toEqual([
      "account_type",
      "created_at",
      "github_account_id",
      "id",
      "ingest_token",
      "installation_id",
      "name",
      "slug",
      "suspended_at",
      "uninstalled_at",
    ]);
    expect(await columns("memberships")).toEqual([
      "id",
      "organization_id",
      "role",
      "synced_at",
      "user_id",
    ]);
    expect(await columns("users")).not.toContain("team_id");
    expect(await columns("users")).not.toContain("role");
    expect(await columns("repos")).toContain("organization_id");
    expect(await columns("repos")).not.toContain("team_id");
  });

  it("give repos their GitHub id and visibility", async () => {
    expect(await columns("repos")).toEqual([
      "created_at",
      "github_repo_id",
      "id",
      "name",
      "organization_id",
      "owner",
      "private",
      "removed_at",
    ]);
  });

  it("store GitHub ids past the int32 limit", async () => {
    const big = 2 ** 31 + 7;
    const [user] = await database
      .insert(users)
      .values({ githubId: big, login: "wide" })
      .returning();
    const [organization] = await database
      .insert(organizations)
      .values({
        githubAccountId: big,
        accountType: "user",
        slug: "wide",
        name: "wide",
        installationId: big + 1,
      })
      .returning();
    expect(user!.githubId).toBe(big);
    expect(organization).toMatchObject({
      githubAccountId: big,
      installationId: big + 1,
    });
  });

  it("allow one membership per user and organization", async () => {
    const [user] = await database
      .insert(users)
      .values({ githubId: 1, login: "mona" })
      .returning();
    const [organization] = await database
      .insert(organizations)
      .values({
        githubAccountId: 10,
        accountType: "organization",
        slug: "acme",
        name: "Acme",
      })
      .returning();
    const membership = {
      userId: user!.id,
      organizationId: organization!.id,
      role: "member" as const,
    };
    await database.insert(memberships).values(membership);
    await expect(
      database.insert(memberships).values({ ...membership, role: "owner" }),
    ).rejects.toThrow();
  });

  it("allow one repo_access row per user and repo", async () => {
    const [user] = await database
      .insert(users)
      .values({ githubId: 2, login: "hubot" })
      .returning();
    const [organization] = await database
      .insert(organizations)
      .values({
        githubAccountId: 20,
        accountType: "organization",
        slug: "globex",
        name: "Globex",
      })
      .returning();
    const [repo] = await database
      .insert(repos)
      .values({ organizationId: organization!.id, owner: "globex", name: "vault" })
      .returning();
    const access = { userId: user!.id, repoId: repo!.id, permission: "read" as const };
    await database.insert(repoAccess).values(access);
    await expect(
      database.insert(repoAccess).values({ ...access, permission: "admin" }),
    ).rejects.toThrow();
  });
});
