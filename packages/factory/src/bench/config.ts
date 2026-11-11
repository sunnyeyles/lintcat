/** A versioned benchmark configuration; its content hash is recorded with every result. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { z } from "zod";

import { budgetsSchema, PROFILE_NAMES } from "#src/contract";

const benchConfigSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    description: z.string().optional(),
    model: z.string().min(1).optional(),
    budgets: budgetsSchema.partial().optional(),
    profileOverride: z.enum(PROFILE_NAMES).optional(),
    fixtures: z.array(z.string().min(1)).optional(),
    repeat: z.number().int().min(1).max(10).default(1),
  })
  .strict();
type BenchConfig = z.infer<typeof benchConfigSchema>;

export interface LoadedBenchConfig {
  config: BenchConfig;
  hash: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Hashes the parsed config, so formatting and key order never split one configuration in two. */
export function parseBenchConfig(raw: unknown): LoadedBenchConfig {
  const config = benchConfigSchema.parse(raw);
  return { config, hash: createHash("sha256").update(canonical(config)).digest("hex") };
}

export function loadBenchConfig(file: string): LoadedBenchConfig {
  return parseBenchConfig(JSON.parse(readFileSync(file, "utf8")));
}
