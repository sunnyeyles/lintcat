/** The risk score over the billing-api fixture's base tree, built the way a review builds it. */
import { createSilentLogger } from "@pr-review/logging";
import {
  assessBlastRadius,
  buildReviewIndex,
  type ReviewTarget,
} from "@pr-review/reviewer";
import { describe, expect, it } from "vitest";

import { loadFixture } from "#src/fixture";
import { createFixtureClient } from "#src/fixture-client";

const fixture = loadFixture("architecture-dead-module");
const { owner, repo, pullRequest } = fixture.context;
const target: ReviewTarget = {
  owner,
  repo,
  pullRequestNumber: pullRequest.number,
  headSha: pullRequest.headSha,
};
const logger = createSilentLogger();

const built = buildReviewIndex({
  client: createFixtureClient(fixture).client,
  target,
  baseSha: pullRequest.baseSha,
  enabled: true,
  logger,
});

async function blastRadiusOf(path: string) {
  const { index } = await built;
  const blast = assessBlastRadius({
    index,
    changedFiles: [{ filename: path, status: "modified", additions: 1, deletions: 1 }],
    target,
    logger,
  });
  if (blast === undefined) {
    throw new Error(`the fixture index gave ${path} no blast radius`);
  }
  return blast;
}

describe("risk over the billing-api fixture", () => {
  it("scores a change to a leaf route low", async () => {
    const { impact, risk } = await blastRadiusOf("src/routes/invoices.ts");

    expect(impact.counts.transitive).toBeLessThanOrEqual(2);
    expect(impact.packages).toEqual(["billing-api"]);
    expect(risk.band).toBe("low");
  });

  it("ranks a change to the most-imported module above the leaf", async () => {
    const { index } = await built;
    const [mostImported] = [...(index?.files.values() ?? [])].sort(
      (a, b) => b.importerCount - a.importerCount,
    );
    expect(mostImported?.path).toBe("src/http/request-context.ts");

    const hub = await blastRadiusOf("src/http/request-context.ts");
    const leaf = await blastRadiusOf("src/routes/invoices.ts");

    expect(hub.risk.score).toBeGreaterThan(leaf.risk.score);
  });
});
