import type { RunTrace } from "@/lib/run-trace/types";

export type RunFile = { name: string; text: string };

export type TraceAdapter = {
  id: string;
  label: string;
  /** What a user should hand over, for the "here's what we support" message. */
  hint: string;
  /** 0 means "not mine"; the registry picks the highest score. */
  detect(files: readonly RunFile[]): number;
  parse(files: readonly RunFile[]): RunTrace;
};

export const LIMITS = {
  files: 500,
  bytes: 64 * 1024 * 1024,
  records: 200_000,
  agents: 2_000,
  stepsPerAgent: 5_000,
  text: 20_000,
} as const;
