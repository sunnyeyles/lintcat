import { z } from "zod";

import { findingCategorySchema } from "#src/review-finding";

/** A shape a human marked as noise; it is never counted, only excluded. */
const suppressionSchema = z
  .object({
    category: findingCategorySchema,
    shape: z.string().min(1).max(200),
    /** The title the suppression was recorded from, so a listing reads plainly. */
    title: z.string().min(1).max(300),
    reason: z.string().min(1).max(500).optional(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export type Suppression = z.infer<typeof suppressionSchema>;

/** The whole memory file. Untrusted input: strict, so junk is rejected. */
export const reviewMemorySchema = z
  .object({
    version: z.literal(1),
    /** Legacy per-shape counts from the removed learn-on-merge; read and dropped. */
    shapes: z.array(z.unknown()).optional(),
    suppressions: z.array(suppressionSchema).default([]),
  })
  .strict()
  .transform(({ version, suppressions }) => ({ version, suppressions }));

export type ReviewMemory = z.infer<typeof reviewMemorySchema>;
