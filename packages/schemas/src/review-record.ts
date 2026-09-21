import { z } from "zod";

import { reviewFindingSchema } from "#src/review-finding";

const count = z.number().int().nonnegative();

/** A finding as the dashboard receives it: no patch source, only whether one survived. */
export const reviewRecordFindingSchema = reviewFindingSchema
  .omit({ patch: true })
  .extend({
    agent: z.string().min(1).optional(),
    hasPatch: z.boolean().optional(),
  });

export type ReviewRecordFinding = z.infer<typeof reviewRecordFindingSchema>;

/** One agent's leg of the review, with the four token counters it spent. */
export const reviewRecordAgentRunSchema = z.object({
  agent: z.string().min(1),
  durationMs: count,
  findingCount: count,
  inputTokens: count,
  cacheCreationInputTokens: count,
  cacheReadInputTokens: count,
  outputTokens: count,
});

export type ReviewRecordAgentRun = z.infer<typeof reviewRecordAgentRunSchema>;

/** One file the pull request touched, with its line counts. */
export const reviewRecordChangedFileSchema = z.object({
  path: z.string().min(1),
  status: z.enum(["added", "modified", "removed", "renamed"]),
  additions: count,
  deletions: count,
});

export type ReviewRecordChangedFile = z.infer<
  typeof reviewRecordChangedFileSchema
>;

/** Base64 of gzipped JSON, at roughly 6 MB of compressed snapshot. */
export const MAX_REPOSITORY_GRAPH_BASE64 = 8_000_000;

/**
 * The repository index at `baseSha`, as base64 of gzipped JSON: the payload
 * never mirrors the index's fields, so a new one needs no schema change.
 */
export const reviewRecordGraphSchema = z.object({
  gzip: z.string().min(1).max(MAX_REPOSITORY_GRAPH_BASE64),
  fileCount: count,
  edgeCount: count,
});

export type ReviewRecordGraph = z.infer<typeof reviewRecordGraphSchema>;

/** The `POST /api/ingest` body; a rerun of the same `headSha` replaces it. */
export const reviewRecordSchema = z
  .object({
    owner: z.string().min(1).max(100),
    repo: z.string().min(1).max(100),
    prNumber: z.number().int().positive(),
    headSha: z.string().min(1).max(64),
    agents: z.array(z.string().min(1)),
    summary: z.string(),
    durationMs: count,
    agentRuns: z
      .array(reviewRecordAgentRunSchema)
      .refine(
        (runs) => new Set(runs.map((run) => run.agent)).size === runs.length,
        { message: "each agent may appear once" },
      ),
    findings: z.array(reviewRecordFindingSchema),
    /** The pull request's base commit; absent from a sender that predates it. */
    baseSha: z.string().min(1).max(64).optional(),
    changedFiles: z.array(reviewRecordChangedFileSchema).optional(),
    graph: reviewRecordGraphSchema.optional(),
  })
  .refine(
    (record) => record.graph === undefined || record.baseSha !== undefined,
    {
      message: "a graph needs the baseSha it was built at",
      path: ["baseSha"],
    },
  );

export type ReviewRecord = z.infer<typeof reviewRecordSchema>;
