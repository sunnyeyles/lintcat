import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { authorize } from "@pr-review/db";
import { createDbSource, type DataSource, type ReviewSummary } from "@pr-review/db/dashboard";
import { z } from "zod";

import type { McpEnvironment } from "#src/environment";

const orgSchema = z.string().min(1).describe('The organization slug, as in the dashboard URL /o/<slug>.');
const repoSchema = z
  .string()
  .regex(/^[^/\s]+\/[^/\s]+$/)
  .optional()
  .describe('Limit to one repository, as "owner/name".');
const rangeSchema = z.enum(["7d", "30d", "90d"]).optional().describe("Time window; defaults to 30d.");

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function summarise(review: ReviewSummary) {
  return {
    id: review.id,
    repo: `${review.repo.owner}/${review.repo.name}`,
    prNumber: review.prNumber,
    headSha: review.headSha.slice(0, 7),
    createdAt: review.createdAt,
    agents: review.agents,
    summary: review.summary,
    findingCount: review.findingCount,
    bySeverity: review.bySeverity,
    durationMs: review.durationMs,
    costUsd: Number(review.costUsd.toFixed(4)),
  };
}

interface Scoped {
  source: DataSource;
  repoId?: number;
}

/** The dashboard's own access rules, applied to the signed-in GitHub user. */
async function scope(
  environment: McpEnvironment,
  githubId: () => Promise<number>,
  org: string,
  repo: string | undefined,
): Promise<Scoped> {
  const database = environment.database();
  const [owner, name] = repo?.split("/") ?? [];
  const repoRef = owner && name ? { owner, name } : undefined;
  const session = { githubId: await githubId() };
  let access = await authorize(database, session, org, repoRef);
  if (access.status === "redirect") {
    access = await authorize(database, session, access.slug, repoRef);
  }
  if (access.status !== "allowed") {
    throw new Error(
      repoRef
        ? `No readable repository ${repo} in organization "${org}" for your GitHub account.`
        : `No organization "${org}" that your GitHub account is a member of.`,
    );
  }
  return {
    source: createDbSource(database, access.organization, access.readableRepos.map((entry) => entry.id)),
    ...(access.repo ? { repoId: access.repo.id } : {}),
  };
}

export function registerHistoryTools(
  server: McpServer,
  environment: McpEnvironment,
  githubId: () => Promise<number>,
): void {
  server.registerTool(
    "list_reviews",
    {
      title: "List past reviews",
      description:
        "List the most recent reviews stored by the dashboard for an organization, newest first, with " +
        "finding counts by severity and cost. Only repositories your GitHub account can read are included.",
      inputSchema: {
        org: orgSchema,
        repo: repoSchema,
        limit: z.number().int().min(1).max(100).optional().describe("Defaults to 20."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ org, repo, limit = 20 }) => {
      const { source, repoId } = await scope(environment, githubId, org, repo);
      const reviews = await source.listReviews({ ...(repoId ? { repoId } : {}), limit });
      return json(reviews.map(summarise));
    },
  );

  server.registerTool(
    "get_review",
    {
      title: "Get a past review",
      description:
        "One stored review with every finding (file, line, severity, category, explanation, suggested fix) " +
        "and each agent's run: duration, finding count and token usage. Take the id from list_reviews.",
      inputSchema: { org: orgSchema, id: z.number().int().positive().describe("The review id.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ org, id }) => {
      const { source } = await scope(environment, githubId, org, undefined);
      const review = await source.getReview(id);
      if (review === null) {
        throw new Error(`No review ${id} in organization "${org}" that your GitHub account can read.`);
      }
      return json({
        ...summarise(review),
        findings: review.findings.map(({ id: _id, reviewId: _reviewId, ...finding }) => finding),
        runs: review.runs.map(({ id: _id, reviewId: _reviewId, ...run }) => run),
      });
    },
  );

  server.registerTool(
    "review_trends",
    {
      title: "Review trends and cost",
      description:
        "Aggregates over a time window: review and finding totals, findings per agent and per category, " +
        "the daily series, and token usage with estimated cost per agent and per repository.",
      inputSchema: { org: orgSchema, range: rangeSchema, repo: repoSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ org, range = "30d", repo }) => {
      const { source, repoId } = await scope(environment, githubId, org, repo);
      const [trends, usage] = await Promise.all([
        source.getTrends(range, repoId),
        source.getUsage(range, repoId),
      ]);
      return json({
        range,
        trends,
        usage: {
          totals: usage.totals,
          byAgent: usage.byAgent,
          byRepo: usage.byRepo.map(({ repo: entry, ...rest }) => ({
            repo: `${entry.owner}/${entry.name}`,
            ...rest,
          })),
          points: usage.points,
        },
      });
    },
  );
}
