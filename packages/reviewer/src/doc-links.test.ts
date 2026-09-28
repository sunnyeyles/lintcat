import type { ChangedFile } from "@pr-review/github";
import { buildRepositoryIndex } from "@pr-review/index";
import type { ReviewFinding } from "@pr-review/schemas";
import { describe, expect, it } from "vitest";

import { checkDocLinks, mergeCheckedFindings } from "#src/doc-links";
import { MAX_FINDINGS } from "#src/validate-findings";

const base = new Map([
  ["README.md", "# worker\n\n## Configuration\n\nSee the runbook.\n"],
  ["docs/runbook.md", "# Runbook\n\n## The queue is backing up\n\nCheck the batch size.\n"],
  ["docs/guide.md", "# Guide\n\n## Old section\n"],
  ["src/queue.ts", "export const BATCH_SIZE = 10;\n"],
]);
const index = buildRepositoryIndex({ sha: "0".repeat(40), files: base });

/** A README whose line 5 is replaced by `added`, as head sees it. */
function readmeChange(added: string): { file: ChangedFile; head: string } {
  const head = `# worker\n\n## Configuration\n\n${added}\n`;
  return {
    head,
    file: {
      filename: "README.md",
      status: "modified",
      additions: 1,
      deletions: 1,
      patch: `@@ -5 +5 @@\n-See the runbook.\n+${added}`,
    },
  };
}

async function check(
  added: string,
  { extra = [], heads = {}, withIndex = true }: {
    extra?: ChangedFile[];
    heads?: Record<string, string>;
    withIndex?: boolean;
  } = {},
): Promise<ReviewFinding[]> {
  const { file, head } = readmeChange(added);
  const files: Record<string, string> = { ...heads, "README.md": head };
  return checkDocLinks({
    index: withIndex ? index : undefined,
    scope: [file],
    pullRequest: [file, ...extra],
    readHead: async (path) => {
      const contents = files[path];
      if (contents === undefined) throw new Error(`Not Found: ${path}`);
      return contents;
    },
  });
}

describe("checkDocLinks", () => {
  it("passes a valid anchor into a file the diff does not show", async () => {
    expect(await check("See [the queue](docs/runbook.md#the-queue-is-backing-up).")).toEqual([]);
  });

  it("flags an anchor the target file does not have", async () => {
    const [finding, ...rest] = await check("See [the queue](docs/runbook.md#the-queue-is-stuck).");

    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      file: "README.md",
      line: 5,
      category: "docs",
      title: "Link to docs/runbook.md points at a heading that does not exist",
      confidence: 1,
    });
    expect(finding?.explanation).toContain("`#the-queue-is-backing-up`");
    expect(finding?.evidence).toBeUndefined();
  });

  it("flags a link to a file that does not exist", async () => {
    expect(await check("See [ops](docs/operations.md).")).toMatchObject([
      { line: 5, title: "Link to docs/operations.md points at a file that does not exist" },
    ]);
  });

  it("resolves against head: a file the pull request adds or removes, and a heading it renames", async () => {
    const added: ChangedFile = { filename: "docs/ops.md", status: "added", additions: 1, deletions: 0 };
    const removed: ChangedFile = { filename: "src/queue.ts", status: "removed", additions: 0, deletions: 1 };
    const renamed: ChangedFile = { filename: "docs/guide.md", status: "modified", additions: 1, deletions: 1 };
    const extra = [added, removed, renamed];
    const heads = { "docs/ops.md": "# Ops\n", "docs/guide.md": "# Guide\n\n## New section\n" };

    expect(await check("[ops](docs/ops.md#ops)", { extra, heads })).toEqual([]);
    expect(await check("[queue](src/queue.ts)", { extra, heads })).toHaveLength(1);
    expect(await check("[g](docs/guide.md#new-section)", { extra, heads })).toEqual([]);
    expect(await check("[g](docs/guide.md#old-section)", { extra, heads })).toHaveLength(1);
  });

  it("checks an anchor into the same doc against its head headings", async () => {
    expect(await check("Jump to [config](#configuration).")).toEqual([]);
    expect(await check("Jump to [config](#settings).")).toHaveLength(1);
  });

  it("leaves alone URLs, line anchors, directories and code spans", async () => {
    expect(
      await check(
        "[site](https://example.com/x.md#nope) [line](src/queue.ts#L1) [dir](docs/) [code](`missing.md`)",
      ),
    ).toEqual([]);
  });

  it("leaves alone a broken link the pull request did not add", async () => {
    const { file } = readmeChange("Fine.");

    expect(
      await checkDocLinks({
        index,
        scope: [file],
        pullRequest: [file],
        readHead: async () => "# worker\n\n[old](docs/missing.md)\n\nFine.\n",
      }),
    ).toEqual([]);
  });

  it("says nothing about a target only the missing index could vouch for", async () => {
    expect(await check("[gone](docs/nowhere.md)", { withIndex: false })).toEqual([]);
  });

  it("skips a doc it cannot read at head", async () => {
    const { file } = readmeChange("[gone](docs/nowhere.md)");

    expect(
      await checkDocLinks({
        index,
        scope: [file],
        pullRequest: [file],
        readHead: async () => {
          throw new Error("rate limited");
        },
      }),
    ).toEqual([]);
  });
});

describe("mergeCheckedFindings", () => {
  const checked: ReviewFinding = {
    file: "README.md",
    line: 5,
    category: "docs",
    severity: "low",
    title: "Broken link",
    explanation: "It points at nothing.",
    confidence: 1,
  };

  it("puts checked findings first and drops an agent finding on the same line", () => {
    const agent = { ...checked, title: "Also the link", confidence: 0.9 };
    const other = { ...checked, line: 9, category: "naming" };

    expect(mergeCheckedFindings([checked], [agent, other])).toEqual([checked, other]);
  });

  it("keeps the cap", () => {
    const many = Array.from({ length: MAX_FINDINGS }, (_unused, at) => ({ ...checked, line: 10 + at }));

    expect(mergeCheckedFindings([checked], many)).toHaveLength(MAX_FINDINGS);
  });
});
