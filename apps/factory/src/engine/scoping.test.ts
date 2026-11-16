import { describe, expect, it } from "vitest";

import { validateScoping } from "#src/engine/scoping";

const draft = { category: "bugfix" as const };
const valid = {
  verdict: "change",
  category: "refactor",
  reason: "the defect sits at three call sites",
  evidence: ["src/a.ts:10 parses by hand"],
  followUps: [],
};

describe("validateScoping", () => {
  it("keeps a cited change to another category", () => {
    expect(validateScoping(valid, draft)).toEqual({ ...valid, verdict: "change" });
  });

  it.each([
    ["no evidence", { ...valid, evidence: [" "] }],
    ["the same category", { ...valid, category: "bugfix" }],
    ["no category", { ...valid, category: undefined }],
    ["no reason", { ...valid, reason: "  " }],
    ["a schema miss", { verdict: "change", category: "rewrite" }],
  ])("turns a change with %s into an accept", (_, raw) => {
    expect(validateScoping(raw, draft).verdict).toBe("accept");
  });

  it("trims follow-ups, drops blanks and caps them at five", () => {
    const followUps = [" one ", "", "two", "three", "four", "five", "six"];
    expect(validateScoping({ ...valid, verdict: "accept", followUps }, draft).followUps).toEqual(["one", "two", "three", "four", "five"]);
  });
});
