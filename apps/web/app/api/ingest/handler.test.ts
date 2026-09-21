import {
  agentRuns,
  findings,
  findRepositoryGraph,
  hashIngestToken,
  repos,
  organizations,
  reviews,
  type Database,
} from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import {
  buildRepositoryIndex,
  encodeRepositoryGraph,
  snapshotRepositoryIndex,
} from "@pr-review/index";
import type { ReviewRecord } from "@pr-review/schemas";
import { beforeEach, describe, expect, it } from "vitest";

import { handleIngest } from "./handler";

const record: ReviewRecord = {
  owner: "acme",
  repo: "widgets",
  prNumber: 7,
  headSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f001234567",
  agents: ["security", "performance"],
  summary: "One finding.",
  durationMs: 1_500,
  agentRuns: [
    {
      agent: "security",
      durationMs: 1_400,
      findingCount: 1,
      inputTokens: 100,
      cacheCreationInputTokens: 2_000,
      cacheReadInputTokens: 0,
      outputTokens: 20,
    },
    {
      agent: "performance",
      durationMs: 1_100,
      findingCount: 0,
      inputTokens: 90,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 2_000,
      outputTokens: 15,
    },
  ],
  findings: [
    {
      agent: "security",
      file: "src/auth/session.ts",
      category: "security",
      severity: "high",
      title: "Missing tenant validation",
      explanation: "The session query is not filtered by tenant.",
      confidence: 0.9,
    },
  ],
};

let database: Database;

beforeEach(async () => {
  database = await createTestDatabase();
  await database.insert(organizations).values({
    githubAccountId: 100,
    accountType: "organization",
    slug: "acme",
    name: "Acme",
    ingestToken: hashIngestToken("secret-token"),
  });
});

function post(body: unknown, token?: string): Request {
  return new Request("https://example.test/api/ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function rowCounts() {
  return {
    repos: (await database.select().from(repos)).length,
    reviews: (await database.select().from(reviews)).length,
    agentRuns: (await database.select().from(agentRuns)).length,
    findings: (await database.select().from(findings)).length,
  };
}

const nothing = { repos: 0, reviews: 0, agentRuns: 0, findings: 0 };

describe("handleIngest", () => {
  it("401s with no Authorization header and writes nothing", async () => {
    const response = await handleIngest(post(record), database);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Authorization"),
    });
    expect(await rowCounts()).toEqual(nothing);
  });

  it("401s on an unknown token and writes nothing", async () => {
    const response = await handleIngest(post(record, "wrong"), database);
    expect(response.status).toBe(401);
    expect(await rowCounts()).toEqual(nothing);
  });

  it("400s with Zod issues on a malformed body", async () => {
    const response = await handleIngest(
      post({ ...record, prNumber: "seven" }, "secret-token"),
      database,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: string;
      issues: { path: (string | number)[] }[];
    };
    expect(body.error).toBe("invalid review record");
    expect(body.issues.map((issue) => issue.path)).toContainEqual(["prNumber"]);
    expect(await rowCounts()).toEqual(nothing);
  });

  it("400s when the body is not JSON at all", async () => {
    const request = new Request("https://example.test/api/ingest", {
      method: "POST",
      headers: { authorization: "Bearer secret-token" },
      body: "not json",
    });
    const response = await handleIngest(request, database);
    expect(response.status).toBe(400);
  });

  it("404s when the organization does not own the repo", async () => {
    const response = await handleIngest(
      post({ ...record, owner: "someone-else" }, "secret-token"),
      database,
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("someone-else"),
    });
    expect(await rowCounts()).toEqual(nothing);
  });

  it("200s and stores the review, one agent run per agent, and its findings", async () => {
    const response = await handleIngest(post(record, "secret-token"), database);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { reviewId: number };
    expect(body.reviewId).toEqual(expect.any(Number));
    expect(await rowCounts()).toEqual({
      repos: 1,
      reviews: 1,
      agentRuns: 2,
      findings: 1,
    });
  });

  it("accepts a finding that says it had a patch", async () => {
    const [finding] = record.findings;
    const response = await handleIngest(
      post({ ...record, findings: [{ ...finding, hasPatch: true }] }, "secret-token"),
      database,
    );
    expect(response.status).toBe(200);
  });

  it("still accepts an older reviewer's finding that carries patch source", async () => {
    const [finding] = record.findings;
    const patch = { startLine: 1, endLine: 1, expected: "a", replacement: "b" };
    const response = await handleIngest(
      post({ ...record, findings: [{ ...finding, patch }] }, "secret-token"),
      database,
    );
    expect(response.status).toBe(200);
    expect((await rowCounts()).findings).toBe(1);
  });

  it("updates rather than duplicates when the same commit is posted again", async () => {
    const first = await handleIngest(post(record, "secret-token"), database);
    const second = await handleIngest(
      post({ ...record, summary: "Rerun." }, "secret-token"),
      database,
    );

    const firstBody = (await first.json()) as { reviewId: number };
    const secondBody = (await second.json()) as { reviewId: number };
    expect(secondBody.reviewId).toBe(firstBody.reviewId);
    expect(await rowCounts()).toEqual({
      repos: 1,
      reviews: 1,
      agentRuns: 2,
      findings: 1,
    });
    const rows = await database.select().from(reviews);
    expect(rows[0]?.summary).toBe("Rerun.");
  });

  it("stores a posted repository graph once, whatever the base sha repeats", async () => {
    const snapshot = snapshotRepositoryIndex(
      buildRepositoryIndex({
        sha: "b".repeat(40),
        files: new Map([
          ["src/session.ts", "export const session = 1;\n"],
          ["src/login.ts", "import { session } from './session';\n"],
        ]),
      }),
    );
    const withGraph = {
      ...record,
      baseSha: snapshot.sha,
      changedFiles: [
        { path: "src/login.ts", status: "modified", additions: 4, deletions: 1 },
      ],
      graph: {
        gzip: Buffer.from(encodeRepositoryGraph(snapshot)).toString("base64"),
        fileCount: snapshot.files.length,
        edgeCount: snapshot.edges.length,
      },
    };

    expect((await handleIngest(post(withGraph, "secret-token"), database)).status).toBe(200);
    expect(
      (await handleIngest(post({ ...withGraph, prNumber: 8 }, "secret-token"), database))
        .status,
    ).toBe(200);

    const [repo] = await database.select().from(repos);
    expect(await findRepositoryGraph(database, repo!.id, snapshot.sha)).toEqual(
      snapshot,
    );
    const rows = await database.select().from(reviews);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      baseSha: snapshot.sha,
      changedFiles: withGraph.changedFiles,
    });
  });
});
