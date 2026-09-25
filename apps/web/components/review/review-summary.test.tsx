import type { ReviewRecordRisk } from "@pr-review/schemas";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReviewSummaryPanel } from "./review-summary";

const risk: ReviewRecordRisk = {
  score: 74,
  band: "high",
  partial: false,
  factors: [
    { label: "41 files depend on this change", points: 31 },
    { label: "crosses 3 packages", points: 16 },
  ],
  hubs: [
    { path: "packages/db/src/schema.ts", dependents: 38 },
    { path: "packages/db/src/ingest.ts", dependents: 1 },
  ],
  counts: {
    direct: 12,
    transitive: 41,
    entryPoints: 2,
    untested: 1,
    inCycle: 0,
    brokenImporters: 0,
  },
  packages: 3,
  dependents: ["apps/web/lib/data/server.ts"],
};

const bySeverity = { low: 1, medium: 0, high: 2 };

function text(riskOrNull: ReviewRecordRisk | null): string {
  const markup = renderToStaticMarkup(
    <ReviewSummaryPanel summary="3 findings" bySeverity={bySeverity} risk={riskOrNull} />,
  );
  return markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("ReviewSummaryPanel", () => {
  it("shows no blast radius card for a review stored without a risk", () => {
    const out = text(null);
    expect(out).toContain("3 findings");
    expect(out).not.toContain("Blast radius");
  });

  it("shows the band and score, the reach, the hubs and how the score adds up", () => {
    const out = text(risk);
    expect(out).toContain("Blast radius");
    expect(out).toMatch(/high 74/);
    expect(out).toContain("41 files in 3 packages depend on this change.");
    expect(out).toContain("packages/db/src/schema.ts");
    expect(out).toContain("38 dependents");
    expect(out).toContain("1 dependent ");
    expect(out).toContain("41 files depend on this change +31");
    expect(out).toContain("crosses 3 packages +16");
    expect(out).toContain("Static imports only.");
    expect(out).not.toContain("partial");
  });

  it("says when the index could not see everything", () => {
    expect(text({ ...risk, partial: true })).toContain(
      "Static imports only, and partial:",
    );
  });

  it("words a reach of one file, and of none, without empty sections", () => {
    const one = text({
      ...risk,
      counts: { ...risk.counts, transitive: 1 },
      packages: 0,
    });
    expect(one).toContain("1 file depends on this change.");

    const none = text({
      ...risk,
      score: 0,
      band: "low",
      factors: [],
      hubs: [],
      counts: { ...risk.counts, direct: 0, transitive: 0 },
      packages: 0,
      dependents: [],
    });
    expect(none).toContain("No indexed files depend on this change.");
    expect(none).toMatch(/low 0/);
    expect(none).not.toContain("Most depended-on changed files");
    expect(none).not.toContain("How the score adds up");
  });
});
