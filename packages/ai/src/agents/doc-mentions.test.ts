import { buildRepositoryIndex } from "@pr-review/index";
import { describe, expect, it } from "vitest";

import type { ReviewContext } from "#src/agent-contract";
import { renderDocMentions } from "#src/agents/doc-mentions";
import { buildOpeningPrompt } from "#src/agents/opening-prompt";

const index = buildRepositoryIndex({
  sha: "0".repeat(40),
  files: new Map([
    ["README.md", "Set `NOTIFY_MAX_RETRIES` to raise the attempt count.\n"],
    ["docs/runbook.md", "Default `NOTIFY_MAX_RETRIES` is five.\n"],
    ["src/config.ts", "export const MAX_ATTEMPTS_ENV = \"NOTIFY_MAX_RETRIES\";\n"],
  ]),
});

const configChange = {
  filename: "src/config.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  patch: '@@ -1 +1 @@\n-export const MAX_ATTEMPTS_ENV = "NOTIFY_MAX_RETRIES";\n+export const RETRY_BUDGET_ENV = "NOTIFY_RETRY_BUDGET_MS";',
};

const context: ReviewContext = {
  owner: "acme",
  repo: "worker",
  pullRequest: {
    number: 7,
    title: "Retry budget",
    body: null,
    author: "dev",
    baseRef: "main",
    baseSha: "0".repeat(40),
    headRef: "budget",
    headSha: "1".repeat(40),
  },
  changedFiles: [configChange],
  diff: "",
};

describe("renderDocMentions", () => {
  it("quotes each unchanged doc line naming a changed name, with where it is", () => {
    expect(renderDocMentions(index, context)).toEqual([
      "<doc_mentions>",
      expect.stringContaining("cite it as evidence"),
      "- README.md:1 (NOTIFY_MAX_RETRIES): Set `NOTIFY_MAX_RETRIES` to raise the attempt count.",
      "- docs/runbook.md:1 (NOTIFY_MAX_RETRIES): Default `NOTIFY_MAX_RETRIES` is five.",
      "</doc_mentions>",
      "",
    ]);
  });

  it("leaves out a doc the whole pull request changes, even outside an incremental scope", () => {
    const lines = renderDocMentions(index, {
      changedFiles: [configChange],
      incremental: {
        sinceSha: "2".repeat(40),
        changedFiles: [configChange, { filename: "README.md", status: "modified", additions: 1, deletions: 1 }],
        diff: "",
      },
    });

    expect(lines.join("\n")).not.toContain("README.md:1");
    expect(lines.join("\n")).toContain("docs/runbook.md:1");
  });

  it("is absent without an index or a mention", () => {
    expect(renderDocMentions(undefined, context)).toEqual([]);
    expect(renderDocMentions(index, { ...context, changedFiles: [] })).toEqual([]);
  });

  it("sits in the opening message before the diff", () => {
    const opening = buildOpeningPrompt(context, {
      index,
      budget: { maxListedFiles: 50, tools: true },
    });

    expect(opening.indexOf("</doc_mentions>")).toBeGreaterThan(0);
    expect(opening.indexOf("</doc_mentions>")).toBeLessThan(opening.indexOf("<diff>"));
  });
});
