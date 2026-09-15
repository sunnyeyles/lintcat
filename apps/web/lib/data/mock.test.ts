import { describe, expect, it } from "vitest";

import { createMockSource } from "./mock";

const source = createMockSource();

describe("mock data source", () => {
  it("is deterministic across instances", async () => {
    const a = await createMockSource().listReviews({ limit: 5 });
    const b = await createMockSource().listReviews({ limit: 5 });
    expect(a.map((r) => r.headSha)).toEqual(b.map((r) => r.headSha));
  });

  it("returns reviews newest first", async () => {
    const reviews = await source.listReviews({ limit: 50 });
    const times = reviews.map((r) => r.createdAt.getTime());
    expect(times).toEqual([...times].sort((x, y) => y - x));
  });

  it("agrees between review rollups and their findings", async () => {
    const review = (await source.getReview(1))!;
    expect(review.findings).toHaveLength(review.findingCount);
    const high = review.findings.filter((f) => f.severity === "high").length;
    expect(review.bySeverity.high).toBe(high);
  });

  it("only reports agents the review actually ran", async () => {
    const review = (await source.getReview(3))!;
    expect(review.runs.map((r) => r.agent).sort()).toEqual([...review.agents].sort());
  });

  it("buckets trends into one point per day in range", async () => {
    const trends = await source.getTrends("30d");
    expect(trends.points).toHaveLength(30);
    const summed = trends.points.reduce((n, p) => n + p.reviews, 0);
    expect(summed).toBe(trends.totals.reviews);
  });

  it("splits usage by repo without losing spend", async () => {
    const usage = await source.getUsage("90d");
    const perRepo = usage.byRepo.reduce((n, r) => n + r.costUsd, 0);
    expect(perRepo).toBeCloseTo(usage.totals.costUsd, 6);
  });

  it("scopes a repo query to that repo", async () => {
    const reviews = await source.listReviews({ repoId: 2 });
    expect(reviews.length).toBeGreaterThan(0);
    expect(reviews.every((r) => r.repoId === 2)).toBe(true);
  });

  it("gives every repo a plausible summary", async () => {
    const repos = await source.listRepos();
    expect(repos).toHaveLength(6);
    for (const repo of repos) {
      expect(repo.findingCount).toBeGreaterThanOrEqual(repo.openHighSeverity);
      expect(repo.costUsd).toBeGreaterThan(0);
    }
  });
});
