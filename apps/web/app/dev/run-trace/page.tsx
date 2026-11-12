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
        description="Drop any agent factory's run (Claude Code, OpenTelemetry GenAI, OpenAI Agents SDK, lintcat run format or factory) to see every agent it spawned: what each one did, which tools and commands it ran, and how its run ended."
      />
      <div className="mt-6 space-y-6">
        <LiveRuns />
        <RunTraceExplorer />
      </div>
    </main>
  );
}
