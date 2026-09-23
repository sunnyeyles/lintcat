import { describe, expect, it } from "vitest";

import { parseAnswer } from "@/lib/docs-chat/markdown";

describe("parseAnswer", () => {
  it("splits paragraphs on blank lines and joins wrapped lines", () => {
    expect(parseAnswer("One\ntwo.\n\nThree.")).toEqual([
      { kind: "paragraph", inlines: [{ kind: "text", text: "One two." }] },
      { kind: "paragraph", inlines: [{ kind: "text", text: "Three." }] },
    ]);
  });

  it("parses inline code, bold and docs links", () => {
    expect(parseAnswer("Add `ai-review` under **Settings**, see [Models](/docs/configuration#models).")).toEqual([
      {
        kind: "paragraph",
        inlines: [
          { kind: "text", text: "Add " },
          { kind: "code", text: "ai-review" },
          { kind: "text", text: " under " },
          { kind: "strong", text: "Settings" },
          { kind: "text", text: ", see " },
          { kind: "link", text: "Models", href: "/docs/configuration#models" },
          { kind: "text", text: "." },
        ],
      },
    ]);
  });

  it("renders a link anywhere but a docs page as its text", () => {
    for (const href of [
      "https://evil.example/docs",
      "//evil.example/docs",
      "javascript:void0",
      "/dashboard",
      "/docs/not-a-page",
      "/docs#x\"onmouseover",
    ]) {
      expect(parseAnswer(`[here](${href})`)).toEqual([
        { kind: "paragraph", inlines: [{ kind: "text", text: "here" }] },
      ]);
    }
    expect(parseAnswer("[Quickstart](/docs/quickstart/)")).toEqual([
      { kind: "paragraph", inlines: [{ kind: "link", text: "Quickstart", href: "/docs/quickstart" }] },
    ]);
  });

  it("groups bullets and numbered items into lists", () => {
    expect(parseAnswer("Steps:\n1. Install\n2. Add a key\n\n- a\n* b")).toEqual([
      { kind: "paragraph", inlines: [{ kind: "text", text: "Steps:" }] },
      {
        kind: "list",
        ordered: true,
        items: [[{ kind: "text", text: "Install" }], [{ kind: "text", text: "Add a key" }]],
      },
      { kind: "list", ordered: false, items: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]] },
    ]);
  });

  it("keeps fenced code verbatim, even while its fence is still open", () => {
    expect(parseAnswer("```bash\npnpm  **x**\n```\nAfter.")).toEqual([
      { kind: "code", text: "pnpm  **x**" },
      { kind: "paragraph", inlines: [{ kind: "text", text: "After." }] },
    ]);
    expect(parseAnswer("Run:\n```\npnpm dev")).toEqual([
      { kind: "paragraph", inlines: [{ kind: "text", text: "Run:" }] },
      { kind: "code", text: "pnpm dev" },
    ]);
  });

  it("shows a heading as a bold line", () => {
    expect(parseAnswer("## Setup")).toEqual([
      { kind: "paragraph", inlines: [{ kind: "strong", text: "Setup" }] },
    ]);
  });
});
