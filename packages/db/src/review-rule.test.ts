import { describe, expect, it } from "vitest";

import { REVIEW_LABEL, reviewsPullRequestNow } from "./review-rule";

describe("reviewsPullRequestNow", () => {
  it("never reviews with mode off, even with the label", () => {
    expect(reviewsPullRequestNow("off", [REVIEW_LABEL])).toBe(false);
  });

  it("always reviews in every_pr mode", () => {
    expect(reviewsPullRequestNow("every_pr", [])).toBe(true);
  });

  it("needs the ai-review label in label mode", () => {
    expect(REVIEW_LABEL).toBe("ai-review");
    expect(reviewsPullRequestNow("label", ["bug", REVIEW_LABEL])).toBe(true);
    expect(reviewsPullRequestNow("label", ["bug"])).toBe(false);
    expect(reviewsPullRequestNow("label", [])).toBe(false);
  });
});
