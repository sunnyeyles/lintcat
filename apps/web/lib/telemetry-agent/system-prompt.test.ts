import { describe, expect, it } from "vitest";

import { buildSystemPrompt, safeOrganizationHref } from "@/lib/telemetry-agent/system-prompt";

describe("buildSystemPrompt", () => {
  it("is the fixed rules alone when the member adds nothing", () => {
    expect(buildSystemPrompt("acme", "  ")).not.toContain("<user_instructions>");
    expect(buildSystemPrompt("acme", undefined)).toContain("/o/acme/reviews/{id}");
  });

  it("adds the member's instructions after the rules", () => {
    const prompt = buildSystemPrompt("acme", " Be brief. ");
    expect(prompt.endsWith("<user_instructions>\nBe brief.\n</user_instructions>")).toBe(true);
  });
});

describe("safeOrganizationHref", () => {
  const safe = safeOrganizationHref("acme");

  it("keeps this organization's review and repository pages", () => {
    expect(safe("/o/acme/reviews/12")).toBe("/o/acme/reviews/12");
    expect(safe("/o/acme/repos/acme/widgets")).toBe("/o/acme/repos/acme/widgets");
  });

  it("drops anything else", () => {
    expect(safe("/o/globex/reviews/12")).toBeNull();
    expect(safe("/o/acme/settings")).toBeNull();
    expect(safe("https://evil.example/o/acme/reviews/1")).toBeNull();
    expect(safe("/o/acme/reviews/1?x=1")).toBeNull();
  });
});
