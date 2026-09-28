import type { ReviewRecord, ReviewRecordOverlay } from "@pr-review/schemas";
import { beforeEach, describe, expect, it } from "vitest";

import type { Database } from "./client";
import { ingestReviewRecord } from "./ingest";
import { findReviewMapInputs } from "./review-map";
import { organizations } from "./schema";
import { createTestDatabase } from "./test-database";

const finding = {
  line: 3,
  category: "naming" as const,
  title: "A finding",
  explanation: "Worth a look.",
  confidence: 0.8,
};

const record: ReviewRecord = {
  owner: "acme",
  repo: "widgets",
  prNumber: 7,
  headSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f001234567",
  summary: "2 findings",
  durationMs: 1_000,
  inputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  outputTokens: 0,
  findings: [
    { ...finding, file: "src/a.ts", severity: "high" },
    { ...finding, file: "src/b.ts", severity: "low" },
  ],
  changedFiles: [
    { path: "src/a.ts", status: "renamed", additions: 1, deletions: 0, previousPath: "src/z.ts" },
  ],
};

const overlay: ReviewRecordOverlay = {
  headSha: record.headSha,
  files: [{ path: "src/a.ts", status: "renamed", previousPath: "src/z.ts" }],
  added: [{ from: "src/a.ts", to: "src/b.ts" }],
  removed: [],
  unresolvedImportCount: 0,
  partial: false,
};

let database: Database;
let organizationId: number;

beforeEach(async () => {
  database = await createTestDatabase();
  const [organization] = await database
    .insert(organizations)
    .values({ githubAccountId: 100, accountType: "organization", slug: "acme", name: "Acme" })
    .returning({ id: organizations.id });
  organizationId = organization!.id;
});

async function ingest(input: ReviewRecord): Promise<number> {
  const result = await ingestReviewRecord(database, organizationId, input);
  if (!result.ok) throw new Error(result.reason);
  return result.reviewId;
}

describe("findReviewMapInputs", () => {
  it("returns the changed files, overlay, dependents and each finding's file and severity", async () => {
    const id = await ingest({
      ...record,
      overlay,
      risk: {
        score: 10,
        band: "low",
        partial: false,
        factors: [],
        hubs: [],
        counts: {
          direct: 1,
          transitive: 1,
          entryPoints: 0,
          untested: 0,
          inCycle: 0,
          brokenImporters: 0,
        },
        packages: 1,
        dependents: ["src/c.ts"],
      },
    });

    expect(await findReviewMapInputs(database, id)).toEqual({
      changedFiles: record.changedFiles,
      overlay,
      dependents: ["src/c.ts"],
      findings: [
        { file: "src/a.ts", severity: "high" },
        { file: "src/b.ts", severity: "low" },
      ],
    });
  });

  it("reads null and empty for a review stored without an overlay or a risk", async () => {
    const id = await ingest(record);

    expect(await findReviewMapInputs(database, id)).toMatchObject({
      overlay: null,
      dependents: [],
    });
  });

  it("returns undefined for a review that does not exist", async () => {
    expect(await findReviewMapInputs(database, 999_999)).toBeUndefined();
  });
});
