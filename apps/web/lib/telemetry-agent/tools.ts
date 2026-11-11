import type { DataSource, RepoSummary, ReviewSummary } from "@pr-review/db/dashboard";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { MAX_TOOL_RESULT_CHARS } from "@/lib/telemetry-agent/limits";

const rangeSchema = z
  .enum(["7d", "30d", "90d"])
  .default("30d")
  .describe("How far back to look.");

const repoSchema = z
  .string()
  .regex(/^[\w.-]+\/[\w.-]+$/, "use owner/name")
  .optional()
  .describe('One repository as "owner/name"; omit for the whole organization.');

const usd = (value: number) => Math.round(value * 10_000) / 10_000;

function render(value: unknown): string {
  const json = JSON.stringify(value);
  if (json.length <= MAX_TOOL_RESULT_CHARS) return json;
  return `${json.slice(0, MAX_TOOL_RESULT_CHARS)}\n[... truncated: narrow the range, repository or limit]`;
}

const repoName = (repo: { owner: string; name: string }) => `${repo.owner}/${repo.name}`;

function repoRow(repo: RepoSummary) {
  return {
    repo: repoName(repo),
    private: repo.private,
    reviews: repo.reviewCount,
    findings: repo.findingCount,
    highSeverity: repo.highSeverity,
    lastReviewedAt: repo.lastReviewedAt?.toISOString() ?? null,
    costUsd: usd(repo.costUsd),
  };
}

function reviewRow(review: ReviewSummary) {
  return {
    id: review.id,
    repo: repoName(review.repo),
    prNumber: review.prNumber,
    createdAt: review.createdAt.toISOString(),
    summary: review.summary.slice(0, 300),
    findings: review.findingCount,
    bySeverity: review.bySeverity,
    risk: review.risk,
    durationMs: review.durationMs,
    inputTokens: review.inputTokens,
    cacheReadInputTokens: review.cacheReadInputTokens,
    cacheCreationInputTokens: review.cacheCreationInputTokens,
    outputTokens: review.outputTokens,
    costUsd: usd(review.costUsd),
  };
}

type Scope = { repoId?: number } | { missing: string };

// The source only knows repositories this member may read, so an unknown name and a hidden one look alike.
async function scope(source: DataSource, repo: string | undefined): Promise<Scope> {
  if (!repo) return {};
  const [owner = "", name = ""] = repo.split("/");
  const found = await source.getRepo(owner, name);
  return found ? { repoId: found.id } : { missing: `no repository ${repo} in this organization` };
}

/** Read-only views over the member's own `DataSource`; nothing here can write. */
export function createTelemetryTools(source: DataSource): ToolSet {
  return {
    list_repositories: tool({
      description:
        "Every repository LintCat reviews in this organization, with all-time review, finding, high-severity and cost totals.",
      inputSchema: z.object({}),
      execute: async () => render((await source.listRepos()).map(repoRow)),
    }),
    get_trends: tool({
      description:
        "Review volume and findings by severity per day, findings by category, and totals (reviews, findings, median duration, cost) over a range.",
      inputSchema: z.object({ range: rangeSchema, repo: repoSchema }),
      execute: async ({ range, repo }) => {
        const scoped = await scope(source, repo);
        if ("missing" in scoped) return scoped.missing;
        const trends = await source.getTrends(range, scoped.repoId);
        return render({
          range,
          repo: repo ?? "all",
          ...trends,
          totals: { ...trends.totals, costUsd: usd(trends.totals.costUsd) },
        });
      },
    }),
    get_usage: tool({
      description:
        "Token usage and estimated cost per day and per repository, with totals, over a range.",
      inputSchema: z.object({ range: rangeSchema, repo: repoSchema }),
      execute: async ({ range, repo }) => {
        const scoped = await scope(source, repo);
        if ("missing" in scoped) return scoped.missing;
        const usage = await source.getUsage(range, scoped.repoId);
        return render({
          range,
          repo: repo ?? "all",
          points: usage.points.map((point) => ({ ...point, costUsd: usd(point.costUsd) })),
          byRepo: usage.byRepo.map(({ repo: row, costUsd, ...rest }) => ({
            repo: repoName(row),
            costUsd: usd(costUsd),
            ...rest,
          })),
          totals: { ...usage.totals, costUsd: usd(usage.totals.costUsd) },
        });
      },
    }),
    list_reviews: tool({
      description:
        "Recent reviews, newest first, with their findings by severity, risk, duration, tokens and cost.",
      inputSchema: z.object({
        repo: repoSchema,
        minSeverity: z
          .enum(["low", "medium", "high"])
          .optional()
          .describe("Keep reviews with at least one finding this severe or worse."),
        hasFindings: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ repo, minSeverity, hasFindings, limit }) => {
        const scoped = await scope(source, repo);
        if ("missing" in scoped) return scoped.missing;
        const reviews = await source.listReviews({
          ...(scoped.repoId === undefined ? {} : { repoId: scoped.repoId }),
          ...(minSeverity === undefined ? {} : { minSeverity }),
          ...(hasFindings === undefined ? {} : { hasFindings }),
          limit,
        });
        return render(reviews.map(reviewRow));
      },
    }),
    get_review: tool({
      description: "One review by id, with every finding it published.",
      inputSchema: z.object({ id: z.number().int().positive().max(2 ** 31 - 1) }),
      execute: async ({ id }) => {
        const review = await source.getReview(id);
        if (!review) return `no review ${id} in this organization`;
        return render({
          ...reviewRow(review),
          summary: review.summary,
          changedFiles: review.changedFiles.length,
          findingList: review.findings.map((finding) => ({
            file: finding.file,
            line: finding.line,
            category: finding.category,
            severity: finding.severity,
            confidence: finding.confidence,
            title: finding.title,
            explanation: finding.explanation.slice(0, 600),
          })),
        });
      },
    }),
  };
}
