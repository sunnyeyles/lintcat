import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import type { Database } from "./client";
import {
  memberships,
  organizationSlugRedirects,
  organizations,
  repoAccess,
  repos,
  users,
} from "./schema";
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
  it("keep the ingest token, and the review's own token counters", async () => {
    expect(await columns("organizations")).toContain("ingest_token");
    expect(await columns("findings")).not.toContain("agent");
    expect(await columns("agent_runs")).toEqual([]);
    expect(await columns("reviews")).toEqual([
      "base_sha",
      "cache_creation_input_tokens",
      "cache_read_input_tokens",
      "changed_files",
      "created_at",
      "duration_ms",
      "head_sha",
      "id",
      "input_tokens",
      "output_tokens",
      "pr_number",
      "repo_id",
      "summary",
    ]);
  });

  it("add repository_graphs and the review's base sha and changed files", async () => {
    expect(await columns("repository_graphs")).toEqual([
      "base_sha",
      "created_at",
      "edge_count",
      "file_count",
      "id",
      "repo_id",
      "snapshot",
    ]);
    expect(await columns("reviews")).toContain("base_sha");
    expect(await columns("reviews")).toContain("changed_files");
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

  it("add organization_slug_redirects, one row per retired slug", async () => {
    expect(await columns("organization_slug_redirects")).toEqual([
      "created_at",
      "organization_id",
      "slug",
    ]);
    const [organization] = await database
      .insert(organizations)
      .values({ githubAccountId: 30, accountType: "user", slug: "mona-lisa", name: "Mona-Lisa" })
      .returning();
    const redirect = { slug: "mona", organizationId: organization!.id };
    await database.insert(organizationSlugRedirects).values(redirect);
    await expect(database.insert(organizationSlugRedirects).values(redirect)).rejects.toThrow();
  });
});

describe("the single-reviewer migration on a populated database", () => {
  it("sums each review's agent runs into the review before dropping them", async () => {
    const folder = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
    const journal = JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    const target = journal.entries.findIndex((entry) => entry.tag.startsWith("0009_"));
    const pg = new PGlite();
    const apply = async (tag: string) => {
      const sqlText = readFileSync(join(folder, `${tag}.sql`), "utf8");
      for (const statement of sqlText.split("--> statement-breakpoint")) {
        await pg.exec(statement);
      }
    };
    for (const entry of journal.entries.slice(0, target)) await apply(entry.tag);

    await pg.exec(`
      insert into organizations (github_account_id, account_type, slug, name) values (1, 'user', 'acme', 'acme');
      insert into repos (organization_id, owner, name) values (1, 'acme', 'widgets');
      insert into reviews (repo_id, pr_number, head_sha, agents, summary) values (1, 1, 'a', '{security,performance}', 's'), (1, 2, 'b', '{security}', 's');
      insert into agent_runs (review_id, agent, duration_ms, finding_count, input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens) values
        (1, 'security', 1, 0, 100, 10, 1, 5),
        (1, 'performance', 1, 0, 200, 20, 2, 7);
    `);
    await apply(journal.entries[target]!.tag);

    const result = await pg.query<{
      pr_number: number;
      input_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
      output_tokens: number;
    }>(
      "select pr_number, input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens from reviews order by pr_number",
    );
    expect(result.rows).toEqual([
      {
        pr_number: 1,
        input_tokens: 300,
        cache_creation_input_tokens: 30,
        cache_read_input_tokens: 3,
        output_tokens: 12,
      },
      {
        pr_number: 2,
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      },
    ]);
  });
});
