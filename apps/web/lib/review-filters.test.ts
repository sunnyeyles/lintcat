import { describe, expect, it } from "vitest";

import {
  isFiltered,
  parseReviewFilters,
  reviewFiltersQuery,
  reviewListOptions,
} from "./review-filters";

describe("parseReviewFilters", () => {
  it("reads repository, minimum severity and has-findings", () => {
    expect(
      parseReviewFilters({ repo: "acme/widgets", severity: "medium", findings: "1" }),
    ).toEqual({
      repo: { owner: "acme", name: "widgets" },
      minSeverity: "medium",
      hasFindings: true,
    });
  });

  it("drops values it does not recognise", () => {
    expect(
      parseReviewFilters({ repo: "acme/widgets/extra", severity: "urgent", findings: "yes" }),
    ).toEqual({ hasFindings: false });
    expect(parseReviewFilters({ repo: "/widgets" })).toEqual({ hasFindings: false });
  });

  it("takes the first of a repeated parameter", () => {
    expect(parseReviewFilters({ severity: ["high", "low"] }).minSeverity).toBe("high");
  });
});

describe("reviewFiltersQuery", () => {
  it("round-trips through the URL", () => {
    const filters = {
      repo: { owner: "acme", name: "widgets" },
      minSeverity: "high" as const,
      hasFindings: true,
    };
    const query = reviewFiltersQuery(filters);

    expect(query).toBe("?repo=acme%2Fwidgets&severity=high&findings=1");
    expect(parseReviewFilters(Object.fromEntries(new URLSearchParams(query)))).toEqual(
      filters,
    );
  });

  it("is empty when nothing is filtered", () => {
    expect(reviewFiltersQuery({ hasFindings: false })).toBe("");
    expect(isFiltered({ hasFindings: false })).toBe(false);
  });
});

describe("reviewListOptions", () => {
  it("passes only the filters that are set", () => {
    expect(reviewListOptions({ hasFindings: false })).toEqual({});
    expect(reviewListOptions({ minSeverity: "low", hasFindings: true })).toEqual({
      minSeverity: "low",
      hasFindings: true,
    });
  });
});
