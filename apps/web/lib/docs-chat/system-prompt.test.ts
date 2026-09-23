import { modelChoicesFor } from "@pr-review/ai";
import { describe, expect, it } from "vitest";

import { DOCS_PAGES } from "@/lib/docs";
import { DOCS_CHAT_MODEL, DOCS_CHAT_SYSTEM_PROMPT } from "@/lib/docs-chat/system-prompt";

describe("the docs chat system prompt", () => {
  it("carries every docs page", () => {
    for (const { href, title } of DOCS_PAGES) {
      expect(DOCS_CHAT_SYSTEM_PROMPT).toContain(`<page href="${href}" title="${title}">`);
    }
  });

  it("names a model @pr-review/ai knows", () => {
    expect(modelChoicesFor("anthropic")).toContain(DOCS_CHAT_MODEL);
  });
});
