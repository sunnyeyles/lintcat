import { describe, expect, it } from "vitest";

import { buildRepositoryIndex } from "#src/build";
import { changedNames, docLinesMentioning, namesOnLine } from "#src/doc-mentions";
import { patchLines } from "#src/patch-lines";

const index = buildRepositoryIndex({
  sha: "0".repeat(40),
  files: new Map([
    [
      "README.md",
      [
        "# worker",
        "",
        "| `NOTIFY_MAX_RETRIES` | `5` | Attempts per notification. |",
        "Call `loadConfig` once at boot.",
        "",
      ].join("\n"),
    ],
    ["docs/runbook.md", "Look for `delivery.attempts_exhausted` in the log.\n"],
    ["docs/changed.md", "Mentions `NOTIFY_MAX_RETRIES` too.\n"],
    ["src/config.ts", "export const MAX_ATTEMPTS_ENV = \"NOTIFY_MAX_RETRIES\";\n"],
  ]),
});

const configPatch = [
  "@@ -1,3 +1,3 @@",
  " import { ConfigError } from \"./errors\";",
  "-export const MAX_ATTEMPTS_ENV = \"NOTIFY_MAX_RETRIES\";",
  "+export const RETRY_BUDGET_ENV = \"NOTIFY_RETRY_BUDGET_MS\";",
  " export function loadConfig() {}",
].join("\n");

const retryPatch = [
  "@@ -10,2 +10,2 @@",
  "-    logger.warn(\"delivery.attempts_exhausted\", { attempt });",
  "+    logger.warn(\"delivery.budget_exhausted\", { attempt });",
].join("\n");

describe("patchLines", () => {
  it("numbers added lines on the new side and removed lines on the old", () => {
    expect(patchLines(configPatch)).toEqual({
      added: [{ line: 2, text: 'export const RETRY_BUDGET_ENV = "NOTIFY_RETRY_BUDGET_MS";' }],
      removed: [{ line: 2, text: 'export const MAX_ATTEMPTS_ENV = "NOTIFY_MAX_RETRIES";' }],
    });
  });
});

describe("namesOnLine", () => {
  it("keeps names, dotted keys and their parts, and drops keywords", () => {
    expect(namesOnLine('logger.warn("delivery.attempts_exhausted", { attempt });')).toEqual([
      "logger.warn",
      "logger",
      "warn",
      "delivery.attempts_exhausted",
      "delivery",
      "attempts_exhausted",
      "attempt",
    ]);
    expect(namesOnLine("export const x = await run('--dry-run');")).toEqual(["run", "--dry-run"]);
  });
});

describe("docLinesMentioning", () => {
  const files = [
    { filename: "src/config.ts", status: "modified", patch: configPatch },
    { filename: "src/delivery/retry.ts", status: "modified", patch: retryPatch },
    { filename: "docs/changed.md", status: "modified", patch: "@@ -1 +1 @@\n-a\n+b" },
  ];

  it("lists doc lines naming what the code changes, a removed name first", () => {
    const mentions = docLinesMentioning(
      index,
      changedNames(files),
      new Set(files.map((file) => file.filename)),
    );

    expect(mentions.map(({ file, line, terms, removed }) => ({ file, line, terms, removed }))).toEqual([
      { file: "README.md", line: 3, terms: ["NOTIFY_MAX_RETRIES"], removed: true },
      { file: "docs/runbook.md", line: 1, terms: ["delivery.attempts_exhausted"], removed: true },
    ]);
  });

  it("ignores names a doc change touches", () => {
    const docOnly = [{ filename: "docs/changed.md", status: "modified", patch: "@@ -1 +1 @@\n-`loadConfig`\n+`loadConfig()`" }];

    expect(docLinesMentioning(index, changedNames(docOnly), new Set(["docs/changed.md"]))).toEqual([]);
  });
});
