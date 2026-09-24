import type { BlameRange, BlameRequest, ChangedFile } from "@pr-review/github";
import { createCapturingLogger } from "@pr-review/logging";
import { describe, expect, it, vi } from "vitest";

import type { ReviewTarget } from "#src/review-target";
import {
  BLAME_CONCURRENCY,
  blameTargets,
  codeownersOf,
  MAX_BLAMED_FILES,
  MAX_SUGGESTED_REVIEWERS,
  rankReviewers,
  recencyWeight,
  suggestReviewers,
  type BlamedFile,
} from "#src/suggest-reviewers";

const target: ReviewTarget = {
  owner: "octo-org",
  repo: "example-service",
  pullRequestNumber: 42,
  headSha: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
};
const baseSha = "0000000000000000000000000000000000000000";
const now = new Date("2026-09-24T00:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

function range(
  startLine: number,
  endLine: number,
  login: string | null,
  committedAt = daysAgo(0),
): BlameRange {
  return { startLine, endLine, login, author: login ?? "someone", committedAt };
}

function changed(
  filename: string,
  status: string,
  extra: Partial<ChangedFile> = {},
): ChangedFile {
  return {
    filename,
    status,
    additions: 1,
    deletions: 1,
    patch: "@@ -1,10 +1,10 @@",
    ...extra,
  };
}

/** Every line of the file touched: 1 to 100. */
const wholeFile = [{ startLine: 1, endLine: 100 }];

function rank(blamed: BlamedFile[], owners: string[] = [], author: string | null = "octocat") {
  return rankReviewers({ blamed, owners, author, now });
}

describe("blameTargets", () => {
  it("blames modified, removed and renamed files, never an added one", () => {
    expect(
      blameTargets([
        changed("src/new.ts", "added", { patch: "@@ -0,0 +1,4 @@" }),
        changed("src/edited.ts", "modified"),
        changed("src/gone.ts", "removed", { patch: "@@ -1,8 +0,0 @@" }),
        changed("src/copied.ts", "copied"),
      ]).map((file) => file.path),
    ).toEqual(["src/edited.ts", "src/gone.ts", "src/copied.ts"]);
  });

  it("blames a renamed file at its base path", () => {
    expect(
      blameTargets([
        changed("src/utils.ts", "renamed", {
          previous_filename: "src/util.ts",
          patch: "@@ -3,4 +3,5 @@",
        }),
      ]),
    ).toEqual([
      { path: "src/util.ts", touched: [{ startLine: 3, endLine: 6 }] },
    ]);
  });

  it("blames every line of a removed file that has no patch", () => {
    expect(
      blameTargets([changed("src/gone.ts", "removed", { patch: undefined })]),
    ).toEqual([{ path: "src/gone.ts", touched: undefined }]);
  });

  it("skips a file with no base lines to blame", () => {
    expect(
      blameTargets([
        changed("assets/logo.png", "modified", { patch: undefined }),
        changed("src/moved.ts", "renamed", {
          previous_filename: "src/old.ts",
          patch: undefined,
        }),
        changed("src/grown.ts", "modified", { patch: "@@ -12,0 +13,3 @@" }),
      ]),
    ).toEqual([]);
  });

  it(`keeps the ${MAX_BLAMED_FILES} largest changes, largest first`, () => {
    const files = Array.from({ length: MAX_BLAMED_FILES + 2 }, (_, at) =>
      changed(`src/f${at}.ts`, "modified", { additions: at, deletions: at }),
    );

    const paths = blameTargets(files).map((file) => file.path);

    expect(paths).toHaveLength(MAX_BLAMED_FILES);
    expect(paths[0]).toBe(`src/f${MAX_BLAMED_FILES + 1}.ts`);
    expect(paths).not.toContain("src/f0.ts");
    expect(paths).not.toContain("src/f1.ts");
  });
});

describe("recencyWeight", () => {
  it("halves every 180 days", () => {
    expect(recencyWeight(daysAgo(0), now)).toBe(1);
    expect(recencyWeight(daysAgo(180), now)).toBeCloseTo(0.5);
    expect(recencyWeight(daysAgo(360), now)).toBeCloseTo(0.25);
  });

  it("counts a future commit as today's and an unreadable date as nothing", () => {
    expect(recencyWeight(daysAgo(-30), now)).toBe(1);
    expect(recencyWeight("not a date", now)).toBe(0);
  });
});

describe("rankReviewers", () => {
  it("counts only the blamed lines the change touched", () => {
    const reviewers = rank([
      {
        ranges: [range(1, 10, "alice"), range(11, 40, "bob")],
        touched: [{ startLine: 5, endLine: 14 }],
      },
    ]);

    // alice wrote 5-10 (6 lines) of the touched ten, bob 11-14 (4).
    expect(reviewers).toEqual([
      { handle: "alice", source: "blame", percent: 60 },
      { handle: "bob", source: "blame", percent: 40 },
    ]);
  });

  it("weighs a line by how recently it was written", () => {
    const reviewers = rank([
      {
        ranges: [
          range(1, 10, "old-hand", daysAgo(360)),
          range(11, 15, "newcomer", daysAgo(0)),
        ],
        touched: wholeFile,
      },
    ]);

    // 10 lines at a quarter against 5 at full weight.
    expect(reviewers).toEqual([
      { handle: "newcomer", source: "blame", percent: 66 },
      { handle: "old-hand", source: "blame", percent: 33 },
    ]);
  });

  it("adds one login's lines across files, whatever its case", () => {
    const reviewers = rank([
      { ranges: [range(1, 3, "Alice")], touched: wholeFile },
      { ranges: [range(1, 3, "alice"), range(4, 4, "bob")], touched: undefined },
    ]);

    expect(reviewers).toEqual([
      { handle: "Alice", source: "blame", percent: 85 },
      { handle: "bob", source: "blame", percent: 14 },
    ]);
  });

  it("never suggests the author, a bot or a line with no login, but counts their lines", () => {
    const reviewers = rank(
      [
        {
          ranges: [
            range(1, 10, "OctoCat"),
            range(11, 20, "dependabot[bot]"),
            range(21, 30, null),
            range(31, 40, "alice"),
          ],
          touched: wholeFile,
        },
      ],
      [],
      "octocat",
    );

    expect(reviewers).toEqual([
      { handle: "alice", source: "blame", percent: 25 },
    ]);
  });

  it("keeps the shares it shows at or under 100 in total", () => {
    const reviewers = rank([
      {
        ranges: [range(1, 1, "a"), range(2, 2, "b"), range(3, 3, "c")],
        touched: wholeFile,
      },
    ]);

    const total = reviewers.reduce(
      (sum, reviewer) =>
        sum + (reviewer.source === "blame" ? reviewer.percent : 0),
      0,
    );
    expect(total).toBeLessThanOrEqual(100);
    expect(reviewers.map((reviewer) => reviewer.handle)).toEqual(["a", "b", "c"]);
  });

  it("gives a sole author the whole share", () => {
    expect(
      rank([{ ranges: [range(1, 7, "alice", daysAgo(97))], touched: wholeFile }]),
    ).toEqual([{ handle: "alice", source: "blame", percent: 100 }]);
  });

  it("fills the slots blame leaves with CODEOWNERS owners it did not pick", () => {
    const reviewers = rank(
      [{ ranges: [range(1, 4, "alice")], touched: wholeFile }],
      ["@Alice", "@octocat", "@org/api-team", "@org/API-team", "@carol", "@dave"],
    );

    expect(reviewers).toEqual([
      { handle: "alice", source: "blame", percent: 100 },
      { handle: "org/api-team", source: "codeowners" },
      { handle: "carol", source: "codeowners" },
    ]);
  });

  it(`suggests at most ${MAX_SUGGESTED_REVIEWERS}, blame first`, () => {
    const reviewers = rank(
      [
        {
          ranges: [
            range(1, 4, "a"),
            range(5, 7, "b"),
            range(8, 9, "c"),
            range(10, 10, "d"),
          ],
          touched: wholeFile,
        },
      ],
      ["@org/api-team"],
    );

    expect(reviewers.map((reviewer) => reviewer.handle)).toEqual(["a", "b", "c"]);
  });

  it("suggests nobody when nothing qualifies", () => {
    expect(rank([{ ranges: [range(1, 5, null)], touched: wholeFile }])).toEqual(
      [],
    );
  });
});

describe("codeownersOf", () => {
  const text = [
    "* @org/everyone",
    "src/api/ @org/api-team @alice",
    "docs/ @org/docs",
  ].join("\n");

  it("orders the owners of the changed paths by how many they own", () => {
    expect(
      codeownersOf(text, ["src/api/a.ts", "src/api/b.ts", "README.md"]),
    ).toEqual(["@org/api-team", "@alice", "@org/everyone"]);
  });

  it("is empty without a CODEOWNERS file", () => {
    expect(codeownersOf(undefined, ["src/api/a.ts"])).toEqual([]);
  });
});

describe("suggestReviewers", () => {
  function request(
    blame: ((request: BlameRequest) => Promise<BlameRange[]>) | undefined,
    changedFiles: ChangedFile[],
    codeowners?: string,
  ) {
    const { logger, entries } = createCapturingLogger();
    return {
      entries,
      suggest: () =>
        suggestReviewers({
          client: blame === undefined ? {} : { blame },
          target,
          baseSha,
          author: "octocat",
          changedFiles,
          codeowners,
          enabled: true,
          now,
          logger,
        }),
    };
  }

  const event = (entries: Record<string, unknown>[], name: string) =>
    entries.find((entry) => entry["event"] === name);

  it("blames each file at the base commit and logs what it found", async () => {
    const blame = vi.fn(async (_request: BlameRequest) => [range(1, 10, "alice")]);
    const { suggest, entries } = request(blame, [changed("src/a.ts", "modified")]);

    await expect(suggest()).resolves.toEqual([
      { handle: "alice", source: "blame", percent: 100 },
    ]);
    expect(blame).toHaveBeenCalledExactlyOnceWith({
      owner: target.owner,
      repo: target.repo,
      ref: baseSha,
      path: "src/a.ts",
    });
    expect(event(entries, "reviewers.suggested")).toMatchObject({
      repository: "octo-org/example-service",
      count: 1,
      blamedFileCount: 1,
      failedFileCount: 0,
      durationMs: expect.any(Number),
    });
  });

  it("still counts the other files when one file's blame fails", async () => {
    const blame = vi.fn(async ({ path }: BlameRequest) => {
      if (path === "src/broken.ts") {
        throw new Error("blame timed out");
      }
      return [range(1, 10, path === "src/a.ts" ? "alice" : "bob")];
    });
    const { suggest, entries } = request(blame, [
      changed("src/a.ts", "modified"),
      changed("src/broken.ts", "modified"),
      changed("src/b.ts", "modified"),
    ]);

    const reviewers = await suggest();

    expect(reviewers.map((reviewer) => reviewer.handle)).toEqual(["alice", "bob"]);
    expect(event(entries, "reviewers.blame_failed")).toMatchObject({
      level: "error",
      path: "src/broken.ts",
      reason: "blame timed out",
    });
    expect(event(entries, "reviewers.suggested")).toMatchObject({
      count: 2,
      blamedFileCount: 2,
      failedFileCount: 1,
    });
  });

  it(`keeps at most ${BLAME_CONCURRENCY} blame calls in flight`, async () => {
    let inFlight = 0;
    let most = 0;
    const blame = vi.fn(async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return [range(1, 1, "alice")];
    });
    const files = Array.from({ length: MAX_BLAMED_FILES }, (_, at) =>
      changed(`src/f${at}.ts`, "modified"),
    );
    const { suggest } = request(blame, files);

    await suggest();

    expect(blame).toHaveBeenCalledTimes(MAX_BLAMED_FILES);
    expect(most).toBe(BLAME_CONCURRENCY);
  });

  it("falls back to CODEOWNERS on a client that cannot blame", async () => {
    const { suggest } = request(
      undefined,
      [changed("src/api/a.ts", "modified")],
      "src/api/ @octocat @org/api-team",
    );

    await expect(suggest()).resolves.toEqual([
      { handle: "org/api-team", source: "codeowners" },
    ]);
  });

  it("logs a wholesale failure and suggests nobody", async () => {
    const broken = { ...changed("src/a.ts", "modified"), patch: 7 };
    const { suggest, entries } = request(
      async () => [range(1, 1, "alice")],
      [broken as unknown as ChangedFile],
    );

    await expect(suggest()).resolves.toEqual([]);
    expect(event(entries, "reviewers.failed")).toMatchObject({
      level: "error",
      fallback: "publishing without suggested reviewers",
    });
    expect(event(entries, "reviewers.suggested")).toBeUndefined();
  });

  it("reads nothing when switched off", async () => {
    const blame = vi.fn(async () => [range(1, 1, "alice")]);
    const { logger, entries } = createCapturingLogger();

    await expect(
      suggestReviewers({
        client: { blame },
        target,
        baseSha,
        author: "octocat",
        changedFiles: [changed("src/a.ts", "modified")],
        codeowners: "* @org/everyone",
        enabled: false,
        now,
        logger,
      }),
    ).resolves.toEqual([]);
    expect(blame).not.toHaveBeenCalled();
    expect(event(entries, "reviewers.skipped")).toBeDefined();
  });
});
