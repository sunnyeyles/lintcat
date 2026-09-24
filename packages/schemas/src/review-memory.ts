import { z } from "zod";

import { findingCategorySchema } from "#src/review-finding";

const count = z.number().int().nonnegative();

/** One (category, title shape) pair and how the repository has treated it. */
const memoryShapeSchema = z
  .object({
    category: findingCategorySchema,
    shape: z.string().min(1).max(200),
    resolved: count,
    ignored: count,
    outdated: count,
    lastSignalAt: z.iso.datetime(),
  })
  .strict();

export type MemoryShape = z.infer<typeof memoryShapeSchema>;

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
    shapes: z.array(memoryShapeSchema),
    suppressions: z.array(suppressionSchema).default([]),
  })
  .strict();

export type ReviewMemory = z.infer<typeof reviewMemorySchema>;
