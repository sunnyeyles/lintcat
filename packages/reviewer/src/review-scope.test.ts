import { CHECK_RUN_NAME, type ChangedFile } from "@pr-review/github";
import { createCapturingLogger } from "@pr-review/logging";
import { describe, expect, it, vi } from "vitest";

import {
  intersectWithPullRequest,
  renderDiff,
  resolveReviewScope,
  wholePullRequest,
} from "#src/review-scope";
import type { ReviewTarget } from "#src/review-target";

const target: ReviewTarget = {
  owner: "octo-org",
  repo: "example-service",
  pullRequestNumber: 7,
  headSha: "head999",
};

function file(filename: string, patch = `@@ -1 +1 @@\n+${filename}\n`): ChangedFile {
  return { filename, status: "modified", additions: 1, deletions: 0, patch };
}

const changedFiles = [file("src/a.ts"), file("src/b.ts")];
const diff = "the whole pull request diff";

function completedRun(name = CHECK_RUN_NAME) {
  return { name, status: "completed" };
}

interface ClientOptions {
  commits?: string[];
  runs?: Record<string, { name: string; status: string }[]>;
  comparison?: { status: "ahead" | "behind" | "identical" | "diverged"; files: ChangedFile[] };
  failOn?: "commits" | "runs" | "compare";
}

function makeClient(options: ClientOptions = {}) {
  const runs = options.runs ?? {};
  return {
    listPullRequestCommitShas: vi.fn(async () => {
      if (options.failOn === "commits") {
        throw new Error("no commits for you");
      }
      return options.commits ?? ["old111", "head999"];
    }),
    listCheckRuns: vi.fn(async ({ sha }: { sha: string }) => {
      if (options.failOn === "runs") {
        throw new Error("checks are not readable");
      }
      return runs[sha] ?? [];
    }),
    compareCommits: vi.fn(async () => {
      if (options.failOn === "compare") {
        throw new Error("compare failed");
      }
      return options.comparison ?? { status: "ahead" as const, files: [file("src/a.ts")] };
    }),
  };
}

function deps(client: ReturnType<typeof makeClient>, incremental = true) {
  return {
    client,
    incremental,
    diff,
    changedFiles,
    logger: createCapturingLogger().logger,
  };
}

describe("resolveReviewScope", () => {
  it("reads nothing when the feature is off", async () => {
    const client = makeClient();

    const scope = await resolveReviewScope(target, deps(client, false));

    expect(scope).toMatchObject({ kind: "full", reason: "not enabled" });
    expect(client.listPullRequestCommitShas).not.toHaveBeenCalled();
  });

  it("narrows to the files changed since the newest reviewed commit", async () => {
    const client = makeClient({
      commits: ["old111", "mid222", "head999"],
      runs: { mid222: [completedRun()] },
    });

    const scope = await resolveReviewScope(target, deps(client));

    expect(scope).toMatchObject({ kind: "incremental", sinceSha: "mid222" });
    expect(scope.changedFiles.map((changed) => changed.filename)).toEqual([
      "src/a.ts",
    ]);
    // The newest reviewed commit wins, so the older one is never asked about.
    expect(client.listCheckRuns).not.toHaveBeenCalledWith(
      expect.objectContaining({ sha: "old111" }),
    );
  });

  it("keeps the whole pull request available alongside the narrowed diff", async () => {
    const client = makeClient({ runs: { old111: [completedRun()] } });

    const scope = await resolveReviewScope(target, deps(client));

    expect(wholePullRequest(scope)).toEqual({ diff, changedFiles });
  });

  it("reviews it all when no earlier commit carries our check run", async () => {
    const client = makeClient({ runs: { old111: [completedRun("Other CI")] } });

    const scope = await resolveReviewScope(target, deps(client));

    expect(scope).toMatchObject({ kind: "full", reason: "no_baseline" });
  });

  it("ignores a check run that never completed", async () => {
    const client = makeClient({
      runs: {
        old111: [{ name: CHECK_RUN_NAME, status: "in_progress" }],
      },
    });

    const scope = await resolveReviewScope(target, deps(client));

    expect(scope).toMatchObject({ kind: "full", reason: "no_baseline" });
  });

  it("reviews it all when the head was rewritten under the baseline", async () => {
    const client = makeClient({
      runs: { old111: [completedRun()] },
      comparison: { status: "diverged", files: [file("src/a.ts")] },
    });

    const scope = await resolveReviewScope(target, deps(client));

    expect(scope).toMatchObject({ kind: "full", reason: "head_rewritten" });
  });

  it("reviews it all, logging the reason, when the baseline cannot be read", async () => {
    const capture = createCapturingLogger();
    const client = makeClient({ failOn: "commits" });

    const scope = await resolveReviewScope(target, {
      ...deps(client),
      logger: capture.logger,
    });

    expect(scope).toMatchObject({ kind: "full", reason: "baseline_unreadable" });
    expect(capture.entries.map((entry) => entry.event)).toContain(
      "review.scope_unreadable",
    );
  });

  it("drops files the base branch brought in, which this pull request never touched", async () => {
    const client = makeClient({
      runs: { old111: [completedRun()] },
      comparison: {
        status: "ahead",
        files: [file("src/a.ts"), file("unrelated/from-main.ts")],
      },
    });

    const scope = await resolveReviewScope(target, deps(client));

    expect(scope.changedFiles.map((changed) => changed.filename)).toEqual([
      "src/a.ts",
    ]);
  });

  it("narrows to nothing when only files outside the pull request moved", async () => {
    const client = makeClient({
      runs: { old111: [completedRun()] },
      comparison: { status: "ahead", files: [file("unrelated/from-main.ts")] },
    });

    const scope = await resolveReviewScope(target, deps(client));

    expect(scope).toMatchObject({ kind: "incremental", changedFiles: [] });
  });

  it("logs the resolved scope with both file counts", async () => {
    const capture = createCapturingLogger();
    const client = makeClient({ runs: { old111: [completedRun()] } });

    await resolveReviewScope(target, { ...deps(client), logger: capture.logger });

    expect(
      capture.entries.find((entry) => entry.event === "review.scope_resolved"),
    ).toMatchObject({
      kind: "incremental",
      sinceSha: "old111",
      incrementalFileCount: 1,
      pullRequestFileCount: 2,
    });
  });
});

describe("intersectWithPullRequest", () => {
  it("keeps the comparison's own patch, not the pull request's", () => {
    const since = [file("src/a.ts", "@@ -1 +1 @@\n+since the baseline\n")];

    const [kept] = intersectWithPullRequest(since, changedFiles);

    expect(kept?.patch).toContain("since the baseline");
  });
});

describe("renderDiff", () => {
  it("renders one header per file, skipping files with no patch", () => {
    const rendered = renderDiff([
      file("src/a.ts"),
      { filename: "logo.png", status: "modified", additions: 0, deletions: 0 },
    ]);

    expect(rendered).toContain("diff --git a/src/a.ts b/src/a.ts");
    expect(rendered).not.toContain("logo.png");
  });
});
