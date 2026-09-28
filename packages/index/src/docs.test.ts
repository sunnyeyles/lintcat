import { describe, expect, it } from "vitest";

import { buildRepositoryIndex } from "#src/build";
import { headingSlug, isDocPath, mentionedTerms, readDoc, resolveDocLink } from "#src/docs";

const RUNBOOK = [
  "# Runbook — notify-worker",
  "",
  "## The endpoint is flapping",
  "",
  "The worker gives each notification `NOTIFY_MAX_RETRIES` attempts; see [config](../README.md#configuration).",
  "Run `runWorker()` with `--dry-run`, or log `delivery.attempts_exhausted`.",
  "",
  "```bash",
  "kubectl set env deployment/notify-worker NOTIFY_MAX_RETRIES=12",
  "## not a heading",
  "```",
  "",
  "## The endpoint is flapping",
  "",
  "Setext heading",
  "--------------",
  '<a id="manual-anchor"></a>',
  "[ref]: ./architecture.md",
  "",
].join("\n");

describe("readDoc", () => {
  const doc = readDoc("docs/runbook.md", RUNBOOK);

  it("records headings with GitHub's anchors, duplicates suffixed", () => {
    expect(doc.headings).toEqual([
      { text: "Runbook — notify-worker", anchor: "runbook--notify-worker", line: 1 },
      { text: "The endpoint is flapping", anchor: "the-endpoint-is-flapping", line: 3 },
      { text: "The endpoint is flapping", anchor: "the-endpoint-is-flapping-1", line: 13 },
      { text: "Setext heading", anchor: "setext-heading", line: 15 },
    ]);
  });

  it("counts an explicit HTML id as an anchor", () => {
    expect(doc.anchors).toContain("manual-anchor");
  });

  it("records links, reference definitions included", () => {
    expect(doc.links).toEqual([
      { target: "../README.md#configuration", line: 5 },
      { target: "./architecture.md", line: 18 },
    ]);
  });

  it("records env vars, identifiers, flags and keys with their line", () => {
    const at = (line: number) =>
      doc.mentions.filter((mention) => mention.line === line).map(({ term, kind }) => ({ term, kind }));

    expect(at(5)).toEqual([{ term: "NOTIFY_MAX_RETRIES", kind: "env" }]);
    expect(at(6)).toEqual([
      { term: "runWorker", kind: "identifier" },
      { term: "--dry-run", kind: "flag" },
      { term: "delivery.attempts_exhausted", kind: "key" },
    ]);
    expect(at(9)).toEqual([{ term: "NOTIFY_MAX_RETRIES", kind: "env" }]);
    expect(doc.mentions.find((mention) => mention.line === 5)?.text).toMatch(/^The worker gives/);
  });
});

describe("mentionedTerms", () => {
  it("takes env vars from prose but not ordinary words", () => {
    expect(mentionedTerms("Set NOTIFY_QUEUE_URL before the Worker starts")).toEqual([
      "NOTIFY_QUEUE_URL",
    ]);
  });

  it("finds the env var inside a dotted code span", () => {
    expect(mentionedTerms("read from `process.env.API_TOKEN`")).toEqual([
      "process.env.API_TOKEN",
      "API_TOKEN",
    ]);
  });
});

describe("headingSlug", () => {
  it.each([
    ["Running it", "running-it"],
    ["`loadConfig` and **friends**", "loadconfig-and-friends"],
    ["What's new? (v2)", "whats-new-v2"],
    ["[Linked](https://x.test) heading", "linked-heading"],
  ])("%s -> %s", (text, slug) => {
    expect(headingSlug(text)).toBe(slug);
  });
});

describe("resolveDocLink", () => {
  it.each([
    ["docs/runbook.md", "../README.md#configuration", { path: "README.md", fragment: "configuration" }],
    ["docs/runbook.md", "./architecture.md", { path: "docs/architecture.md", fragment: "" }],
    ["docs/runbook.md", "#the-endpoint", { path: "docs/runbook.md", fragment: "the-endpoint" }],
    ["docs/runbook.md", "/src/config.ts?plain=1#L3", { path: "src/config.ts", fragment: "L3" }],
    ["docs/runbook.md", "guide%20one.md", { path: "docs/guide one.md", fragment: "" }],
  ])("from %s, %s", (from, target, expected) => {
    expect(resolveDocLink(from, target)).toEqual(expected);
  });

  it.each(["https://example.com/a.md", "mailto:ops@example.com", "//cdn.test/x", "../../../up.md"])(
    "leaves %s alone",
    (target) => {
      expect(resolveDocLink("docs/runbook.md", target)).toBeUndefined();
    },
  );
});

describe("the index's docs", () => {
  it("reads every Markdown file and nothing else", () => {
    const index = buildRepositoryIndex({
      sha: "0".repeat(40),
      files: new Map([
        ["README.md", "# Title\n"],
        ["docs/guide.mdx", "## Guide\n"],
        ["src/a.ts", "// # not a doc\n"],
      ]),
    });

    expect([...index.docs.keys()]).toEqual(["README.md", "docs/guide.mdx"]);
    expect(index.docs.get("docs/guide.mdx")?.anchors).toEqual(["guide"]);
  });

  it.each([
    ["README.md", true],
    ["docs/Guide.MARKDOWN", true],
    ["src/readme.ts", false],
  ])("isDocPath(%s) is %s", (path, expected) => {
    expect(isDocPath(path)).toBe(expected);
  });
});
