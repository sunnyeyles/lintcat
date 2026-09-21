import { z } from "zod";

import { reviewFindingSchema } from "#src/review-finding";

const count = z.number().int().nonnegative();

/** A finding as the dashboard receives it: no patch source, only whether one survived. */
export const reviewRecordFindingSchema = reviewFindingSchema
  .omit({ patch: true })
  .extend({ hasPatch: z.boolean().optional() });

export type ReviewRecordFinding = z.infer<typeof reviewRecordFindingSchema>;

/** The `POST /api/ingest` body; a rerun of the same `headSha` replaces it. */
export const reviewRecordSchema = z.object({
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
});

export type ReviewRecord = z.infer<typeof reviewRecordSchema>;
