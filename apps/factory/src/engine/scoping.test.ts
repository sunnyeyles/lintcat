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
    ["only uncited evidence", { ...valid, evidence: ["the parser is hand-rolled", "see a.ts"] }],
    ["the same category", { ...valid, category: "bugfix" }],
    ["no category", { ...valid, category: undefined }],
    ["no reason", { ...valid, reason: "  " }],
    ["a schema miss", { verdict: "change", category: "rewrite" }],
  ])("turns a change with %s into an accept", (_, raw) => {
    expect(validateScoping(raw, draft).verdict).toBe("accept");
  });

  it("drops evidence items that cite no file and line", () => {
    const evidence = ["src/a.ts:10 parses by hand", "parsing is duplicated"];
    expect(validateScoping({ ...valid, evidence }, draft)).toMatchObject({ verdict: "change", evidence: ["src/a.ts:10 parses by hand"] });
  });

  it("trims follow-ups, drops blanks and caps them at five", () => {
    const followUps = [" one ", "", "two", "three", "four", "five", "six"];
    expect(validateScoping({ ...valid, verdict: "accept", followUps }, draft).followUps).toEqual(["one", "two", "three", "four", "five"]);
  });
});
