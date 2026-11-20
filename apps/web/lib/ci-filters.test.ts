import { describe, expect, it } from "vitest";

import { ciFiltersQuery, parseCiFilters } from "@/lib/ci-filters";

describe("parseCiFilters", () => {
  it("reads branch, workflow and conclusion", () => {
    expect(
      parseCiFilters({ branch: "feature/x", workflow: "7000000001", conclusion: "failure" }),
    ).toEqual({ branch: "feature/x", workflowId: 7_000_000_001, conclusion: "failure" });
  });

  it("drops what it does not recognise", () => {
    expect(
      parseCiFilters({ branch: "  ", workflow: "ci.yml", conclusion: "neutral" }),
    ).toEqual({});
    expect(parseCiFilters({ workflow: "-1", branch: ["main", "dev"] })).toEqual({
      branch: "main",
    });
  });
});

describe("ciFiltersQuery", () => {
  it("round-trips through the parser", () => {
    const filters = { branch: "a b&c", workflowId: 3, conclusion: "success" as const };
    const query = ciFiltersQuery(filters);
    expect(parseCiFilters(Object.fromEntries(new URLSearchParams(query)))).toEqual(filters);
  });

  it("is empty with no filters", () => {
    expect(ciFiltersQuery({})).toBe("");
  });
});
