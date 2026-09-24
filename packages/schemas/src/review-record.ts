import { z } from "zod";

import { reviewFindingSchema } from "#src/review-finding";

const count = z.number().int().nonnegative();

/** A finding as the dashboard receives it: no patch source, only whether one survived. */
const reviewRecordFindingSchema = reviewFindingSchema
  .omit({ patch: true })
  .extend({ hasPatch: z.boolean().optional() });

/** One file the pull request touched, with its line counts. */
const reviewRecordChangedFileSchema = z.object({
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
const reviewRecordGraphSchema = z.object({
  gzip: z.string().min(1).max(MAX_REPOSITORY_GRAPH_BASE64),
  fileCount: count,
  edgeCount: count,
});

export type ReviewRecordGraph = z.infer<typeof reviewRecordGraphSchema>;

/** One review as the dashboard stores it; a rerun of the same `headSha` replaces it. */
export const reviewRecordSchema = z
  .object({
    owner: z.string().min(1).max(100),
    repo: z.string().min(1).max(100),
    prNumber: z.number().int().positive(),
    headSha: z.string().min(1).max(64),
    summary: z.string(),
    durationMs: count,
    // Older actions omit these; unknown keys such as `agentRuns` are stripped.
    inputTokens: count.default(0),
    cacheCreationInputTokens: count.default(0),
    cacheReadInputTokens: count.default(0),
    outputTokens: count.default(0),
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
