import type { RunFile } from "@/lib/run-trace/adapters/types";

export type TraceRunSummary = {
  runId: string;
  title: string | null;
  format: string | null;
  startedAt: Date;
  lastSeenAt: Date;
};

type TraceRunFiles = { run: TraceRunSummary; files: RunFile[] };

/** A source the web app reads itself, as opposed to runs pushed to it. */
export interface RunTraceConnector {
  id: string;
  label: string;
  list(limit: number): Promise<TraceRunSummary[]>;
  read(runId: string): Promise<TraceRunFiles | undefined>;
}
