import { z } from "zod";

import { reviewFindingSchema } from "#src/review-finding";

/** A local review as `pr-review review --format json` prints it; patches in it are verified. */
export const localReviewReportSchema = z.object({
  version: z.literal(1),
  profile: z.enum(["local", "ci"]),
  model: z.object({ provider: z.string(), modelId: z.string() }).nullable(),
  baseRef: z.string(),
  baseSha: z.string(),
  // The commit or tree reviewed; uncommitted changes are snapshotted into a tree.
  head: z.string(),
  failOn: z.enum(["low", "medium", "high", "off"]),
  // Answered from an earlier run over the same tree, base and model.
  cached: z.boolean(),
  findings: z.array(
    // suppressedLocally: CI will still post it, but it no longer blocks locally.
    reviewFindingSchema.extend({ id: z.string(), suppressedLocally: z.boolean().optional() }),
  ),
  blocking: z.number().int().nonnegative(),
  suppressed: z.number().int().nonnegative(),
  // The check-run markdown CI would have posted; empty when nothing was reviewed.
  summary: z.string(),
});

export type LocalReviewReport = z.infer<typeof localReviewReportSchema>;
