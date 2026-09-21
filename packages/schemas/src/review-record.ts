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

/** The `POST /api/ingest` body; a rerun of the same `headSha` replaces it. */
export const reviewRecordSchema = z.object({
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
});

export type ReviewRecord = z.infer<typeof reviewRecordSchema>;
