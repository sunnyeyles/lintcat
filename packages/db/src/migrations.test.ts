import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import type { Database } from "./client";
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
    expect(await columns("teams")).toContain("ingest_token");
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
});
