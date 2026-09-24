import type { ChangedFile } from "@pr-review/github";
import { buildRepositoryIndex, type RepositoryIndex } from "@pr-review/index";
import { createCapturingLogger } from "@pr-review/logging";
import { describe, expect, it } from "vitest";

import { assessBlastRadius, impactChanges } from "#src/blast-radius";
import type { ReviewTarget } from "#src/review-target";

const target: ReviewTarget = {
  owner: "octo-org",
  repo: "example-service",
  pullRequestNumber: 42,
  headSha: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
};

function changed(
  filename: string,
  status: string,
  extra: Partial<ChangedFile> = {},
): ChangedFile {
  return { filename, status, additions: 1, deletions: 0, ...extra };
}

const index = buildRepositoryIndex({
  sha: "base",
  files: new Map([
    ["src/util.ts", "export const util = 1;\n"],
    ["src/a.ts", "import { util } from './util';\n"],
    ["src/b.ts", "import { util } from './util';\n"],
  ]),
  truncated: false,
});

describe("impactChanges", () => {
  it("maps GitHub's statuses onto the four the graph knows", () => {
    expect(
      impactChanges([
        changed("src/new.ts", "added"),
        changed("src/gone.ts", "removed"),
        changed("src/copy.ts", "copied"),
        changed("src/mode.ts", "changed"),
        changed("src/same.ts", "unchanged"),
      ]).map((change) => change.status),
    ).toEqual(["added", "removed", "modified", "modified", "modified"]);
  });

  it("keeps a rename's base path", () => {
    expect(
      impactChanges([
        changed("src/utils.ts", "renamed", {
          previous_filename: "src/util.ts",
        }),
      ]),
    ).toEqual([
      { path: "src/utils.ts", status: "renamed", previousPath: "src/util.ts" },
    ]);
  });
});

describe("assessBlastRadius", () => {
  it("scores the change and logs it", () => {
    const { logger, entries } = createCapturingLogger();

    const blast = assessBlastRadius({
      index,
      changedFiles: [changed("src/util.ts", "modified")],
      target,
      logger,
    });

    expect(blast?.impact.counts.transitive).toBe(2);
    expect(blast?.risk.score).toBeGreaterThan(0);
    expect(
      entries.find((entry) => entry["event"] === "risk.scored"),
    ).toMatchObject({
      repository: "octo-org/example-service",
      score: blast?.risk.score,
      band: blast?.risk.band,
      durationMs: expect.any(Number),
    });
  });

  it("follows a rename back to the base file's importers", () => {
    const { logger } = createCapturingLogger();

    const blast = assessBlastRadius({
      index,
      changedFiles: [
        changed("src/utils.ts", "renamed", {
          previous_filename: "src/util.ts",
        }),
      ],
      target,
      logger,
    });

    expect(blast?.impact.counts.brokenImporters).toBe(2);
  });

  it("is undefined without an index", () => {
    const { logger, entries } = createCapturingLogger();

    expect(
      assessBlastRadius({ index: undefined, changedFiles: [], target, logger }),
    ).toBeUndefined();
    expect(entries).toEqual([]);
  });

  it("logs a failure instead of throwing", () => {
    const { logger, entries } = createCapturingLogger();
    const broken = { ...index, files: undefined } as unknown as RepositoryIndex;

    expect(
      assessBlastRadius({
        index: broken,
        changedFiles: [changed("src/util.ts", "modified")],
        target,
        logger,
      }),
    ).toBeUndefined();
    expect(
      entries.find((entry) => entry["event"] === "risk.failed"),
    ).toMatchObject({
      level: "error",
      fallback: "publishing without the blast radius",
    });
  });
});
