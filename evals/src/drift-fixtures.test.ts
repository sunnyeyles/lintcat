/** The drift fixtures are solvable under validation: the evidence a reviewer would cite survives it. */
import { renderConfigDrift, renderDocMentions, type ReviewEngine } from "@pr-review/ai";
import { changedPaths } from "@pr-review/github";
import { createSilentLogger } from "@pr-review/logging";
import { buildReviewIndex, validateFindings } from "@pr-review/reviewer";
import type { ReviewFinding } from "@pr-review/schemas";
import { describe, expect, it } from "vitest";

import { evalCases } from "#src/cases";
import { evaluateExpectation } from "#src/expectations";
import { loadFixture, type LoadedFixture } from "#src/fixture";
import { createFixtureClient } from "#src/fixture-client";
import { runFixtureReview } from "#src/run-fixture-review";

function lineOf(files: ReadonlyMap<string, string>, file: string, marker: string): number {
  const at = (files.get(file) ?? "").split("\n").findIndex((line) => line.includes(marker));
  if (at === -1) {
    throw new Error(`${marker} is not in ${file}`);
  }
  return at + 1;
}

async function indexOf(fixture: LoadedFixture) {
  const { pullRequest } = fixture.context;
  const { index } = await buildReviewIndex({
    client: createFixtureClient(fixture).client,
    target: {
      owner: fixture.context.owner,
      repo: fixture.context.repo,
      pullRequestNumber: pullRequest.number,
      headSha: pullRequest.headSha,
    },
    baseSha: pullRequest.baseSha,
    enabled: true,
    logger: createSilentLogger(),
  });
  return index;
}

async function survivors(fixture: LoadedFixture, finding: ReviewFinding) {
  return validateFindings([finding], fixture.changedFiles, [finding.category], {
    index: await indexOf(fixture),
    changedPaths: changedPaths(fixture.changedFiles),
  });
}

/** An engine whose agent finds nothing, so only the checks made in code can report. */
const silentEngine: ReviewEngine = {
  createAgent: ({ agent }) => ({ name: agent.name, run: async () => [] }),
};

describe("naming-drift-data-reads", () => {
  const fixture = loadFixture("naming-drift-data-reads");

  it("keeps a finding that cites two sibling reads named find*", async () => {
    const finding: ReviewFinding = {
      file: "src/data/credit-notes.ts",
      line: lineOf(fixture.headFiles, "src/data/credit-notes.ts", "function getCreditNoteById"),
      category: "naming",
      severity: "low",
      title: "Credit note reads are named get*/fetch*, not find*/list*",
      explanation: "Every other data module names a single read find* and a list list*For*.",
      evidence: [
        {
          file: "src/data/invoices.ts",
          line: lineOf(fixture.baseFiles, "src/data/invoices.ts", "function findInvoice("),
        },
        {
          file: "src/data/payments.ts",
          line: lineOf(fixture.baseFiles, "src/data/payments.ts", "function findPayment("),
        },
      ],
      confidence: 0.9,
    };

    expect(await survivors(fixture, finding)).toEqual([finding]);
  });

  it("drops one citing the pull request's own files as the convention", async () => {
    const finding: ReviewFinding = {
      file: "src/data/credit-notes.ts",
      category: "naming",
      severity: "low",
      title: "Credit note reads follow the service",
      explanation: "The service already calls them this way.",
      evidence: [
        { file: "src/services/credit-notes.ts", line: 2 },
        { file: "src/data/invoices.ts", line: 1 },
      ],
      confidence: 0.9,
    };

    expect(await survivors(fixture, finding)).toEqual([]);
  });
});

describe("docs-drift-retry-budget", () => {
  const fixture = loadFixture("docs-drift-retry-budget");

  it("hands the reviewer the doc lines that still document the attempt count", async () => {
    const block = renderDocMentions(await indexOf(fixture), fixture.context).join("\n");

    expect(block).toContain(`README.md:${lineOf(fixture.baseFiles, "README.md", "| `NOTIFY_MAX_RETRIES`")}`);
    expect(block).toContain(`docs/runbook.md:${lineOf(fixture.baseFiles, "docs/runbook.md", "gives each notification")}`);
  });

  it("keeps a finding that cites those doc lines", async () => {
    const finding: ReviewFinding = {
      file: "src/config.ts",
      line: lineOf(fixture.headFiles, "src/config.ts", "export const RETRY_BUDGET_ENV"),
      category: "docs",
      severity: "medium",
      title: "NOTIFY_MAX_RETRIES is gone, but the README and runbook still document it",
      explanation: "The worker now reads NOTIFY_RETRY_BUDGET_MS; operators following the docs set a variable nothing reads.",
      evidence: [
        { file: "README.md", line: lineOf(fixture.baseFiles, "README.md", "| `NOTIFY_MAX_RETRIES`") },
        { file: "docs/runbook.md", line: lineOf(fixture.baseFiles, "docs/runbook.md", "gives each notification") },
      ],
      confidence: 0.9,
    };

    expect(await survivors(fixture, finding)).toEqual([finding]);
  });
});

describe.each(["docs-broken-anchor", "clean-docs-valid-anchor", "clean-docs-reword"])(
  "%s, decided in code",
  (name) => {
    it("meets every expectation with an agent that reports nothing", async () => {
      const fixture = loadFixture(name);
      const review = await runFixtureReview(fixture, {
        engine: silentEngine,
        logger: createSilentLogger(),
      });
      const expectations = evalCases.find((evalCase) => evalCase.fixture === name)?.expectations;

      expect(expectations).toBeDefined();
      for (const expectation of expectations ?? []) {
        expect(evaluateExpectation(review, expectation)).toMatchObject({ passed: true });
      }
    });
  },
);

describe("config-undocumented-env-var", () => {
  const fixture = loadFixture("config-undocumented-env-var");
  const read = lineOf(fixture.headFiles, "src/config.ts", "env.NOTIFY_SIGNING_SECRET");
  const example = lineOf(fixture.baseFiles, ".env.example", "NOTIFY_QUEUE_URL=");
  const readme = lineOf(fixture.baseFiles, "README.md", "| `NOTIFY_QUEUE_URL`");

  it("hands the reviewer the unread variable and where the others are documented", async () => {
    const block = renderConfigDrift(await indexOf(fixture), fixture.context).join("\n");

    expect(block).toContain(`src/config.ts:${read} reads NOTIFY_SIGNING_SECRET`);
    expect(block).toContain(`.env.example:${example}`);
  });

  it("keeps a finding that cites the example and the README", async () => {
    const finding: ReviewFinding = {
      file: "src/config.ts",
      line: read,
      category: "config",
      severity: "medium",
      title: "NOTIFY_SIGNING_SECRET is read but not listed in .env.example or the README",
      explanation: "Every other variable the worker reads is listed in .env.example and the README's configuration table.",
      evidence: [
        { file: ".env.example", line: example },
        { file: "README.md", line: readme },
      ],
      confidence: 0.9,
    };

    expect(await survivors(fixture, finding)).toEqual([finding]);
  });
});

describe("config-duplicate-dependency", () => {
  const fixture = loadFixture("config-duplicate-dependency");
  const added = lineOf(fixture.headFiles, "package.json", '"dayjs"');
  const expiry = lineOf(fixture.baseFiles, "src/delivery/expiry.ts", 'from "date-fns"');
  const queue = lineOf(fixture.baseFiles, "src/queue.ts", 'from "date-fns"');

  it("hands the reviewer the duplicate and where date-fns is already used", async () => {
    const block = renderConfigDrift(await indexOf(fixture), fixture.context).join("\n");

    expect(block).toContain(
      `package.json:${added} adds dayjs for dates, a job date-fns already does here: src/delivery/expiry.ts:${expiry}, src/queue.ts:${queue}`,
    );
  });

  it("keeps a finding that cites the date-fns imports", async () => {
    const finding: ReviewFinding = {
      file: "package.json",
      line: added,
      category: "config",
      severity: "low",
      title: "dayjs duplicates date-fns, which the worker already uses for dates",
      explanation: "The expiry check and the queue poll both use date-fns.",
      evidence: [
        { file: "src/delivery/expiry.ts", line: expiry },
        { file: "src/queue.ts", line: queue },
      ],
      confidence: 0.85,
    };

    expect(await survivors(fixture, finding)).toEqual([finding]);
  });
});

describe("clean-config-env-var-documented", () => {
  it("hands the reviewer no config fact", async () => {
    const fixture = loadFixture("clean-config-env-var-documented");

    expect(renderConfigDrift(await indexOf(fixture), fixture.context)).toEqual([]);
  });
});
