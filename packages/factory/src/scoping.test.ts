import { describe, expect, it } from "vitest";

import type { Spec } from "#src/contract";
import { validateScoping } from "#src/scoping";
import { sampleSpec } from "#src/test-fixtures";

const draft: Spec = { ...sampleSpec, category: "bugfix" };
const change = { verdict: "change", category: "refactor", reason: "four call sites", evidence: ["src/a.mjs:3"], followUps: [] };

describe("validateScoping", () => {
  it("keeps a change with a new category, a reason and evidence", () => {
    expect(validateScoping(change, draft)).toMatchObject({ verdict: "change", from: "bugfix", proposed: "refactor", evidence: ["src/a.mjs:3"] });
  });

  it.each([
    ["no evidence", { ...change, evidence: [" "] }],
    ["the same category", { ...change, category: "bugfix" }],
    ["no category", { ...change, category: undefined }],
    ["no reason", { ...change, reason: "  " }],
    ["a schema miss", { verdict: "change" }],
  ])("downgrades a change with %s to an accept", (_, raw) => {
    expect(validateScoping(raw, draft)).toMatchObject({ verdict: "accept", from: "bugfix", proposed: "bugfix", evidence: [] });
  });

  it("keeps follow-ups on an accept, trimmed and capped", () => {
    const raw = { verdict: "accept", reason: "fits", evidence: [], followUps: ["a", " ", "b", "c", "d", "e", "f"] };
    expect(validateScoping(raw, draft).followUps).toEqual(["a", "b", "c", "d", "e"]);
  });
});
