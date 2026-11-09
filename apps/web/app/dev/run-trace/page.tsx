import type { Metadata } from "next";

import { LiveRuns } from "@/app/dev/run-trace/live-runs";
import { RunTraceExplorer } from "@/app/dev/run-trace/run-trace-explorer";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Run trace" };

export default function RunTraceDevPage() {
  return (
    <main className="mx-auto w-full max-w-[110rem] px-4 py-8">
      <PageHeader
        eyebrow="Dev"
        title="Run trace"
        description="Drop a factory run's trace folder to see every agent it spawned: what each one thought, which tools it called, which files it read and edited, and how full its context window got."
      />
      <div className="mt-6 space-y-6">
        <LiveRuns />
        <RunTraceExplorer />
      </div>
    </main>
  );
}
