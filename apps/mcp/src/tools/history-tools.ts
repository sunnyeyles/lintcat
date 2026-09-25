import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpEnvironment } from "#src/environment";
import { reviewResourceUri } from "#src/resources/context-resources";
import { readStoredReview, scopeToOrganization, summariseReview } from "#src/review-history";
import { json } from "#src/tools/shared";

const orgSchema = z.string().min(1).describe('The organization slug, as in the dashboard URL /o/<slug>.');
const repoSchema = z
  .string()
  .regex(/^[^/\s]+\/[^/\s]+$/)
  .optional()
  .describe('Limit to one repository, as "owner/name".');
const rangeSchema = z.enum(["7d", "30d", "90d"]).optional().describe("Time window; defaults to 30d.");

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
        "finding counts by severity and cost. Each review also comes back as a resource link, so its " +
        "findings can be attached instead of fetched. Only repositories your GitHub account can read " +
        "are included.",
      inputSchema: {
        org: orgSchema,
        repo: repoSchema,
        limit: z.number().int().min(1).max(100).optional().describe("Defaults to 20."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ org, repo, limit = 20 }) => {
      const { source, repoId } = await scopeToOrganization(environment, githubId, org, repo);
      const reviews = await source.listReviews({ ...(repoId ? { repoId } : {}), limit });
      const summaries = reviews.map(summariseReview);
      return {
        content: [
          { type: "text", text: JSON.stringify(summaries, null, 2) },
          ...summaries.map((review) => ({
            type: "resource_link" as const,
            uri: reviewResourceUri(org, review.id),
            name: `${review.repo}#${review.prNumber} review ${review.id}`,
            description: `${review.findingCount} finding(s) at ${review.headSha}. ${review.summary}`,
            mimeType: "application/json",
          })),
        ],
      };
    },
  );

  server.registerTool(
    "get_review",
    {
      title: "Get a past review",
      description:
        "One stored review with every finding (file, line, severity, category, explanation, suggested fix) " +
        "plus the run's duration and token usage. Take the id from list_reviews.",
      inputSchema: { org: orgSchema, id: z.number().int().positive().describe("The review id.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ org, id }) => json(await readStoredReview(environment, githubId, org, id)),
  );

  server.registerTool(
    "review_trends",
    {
      title: "Review trends and cost",
      description:
        "Aggregates over a time window: review and finding totals, findings per category, " +
        "the daily series, and token usage with estimated cost per repository.",
      inputSchema: { org: orgSchema, range: rangeSchema, repo: repoSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ org, range = "30d", repo }) => {
      const { source, repoId } = await scopeToOrganization(environment, githubId, org, repo);
      const [trends, usage] = await Promise.all([
        source.getTrends(range, repoId),
        source.getUsage(range, repoId),
      ]);
      return json({
        range,
        trends,
        usage: {
          totals: usage.totals,
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
