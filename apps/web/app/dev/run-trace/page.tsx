import type { Metadata } from "next";
import Link from "next/link";

import { LiveRuns } from "@/app/dev/run-trace/live-runs";
import { RunTraceExplorer } from "@/app/dev/run-trace/run-trace-explorer";
import { SparsePreview } from "@/app/dev/run-trace/sparse-preview";
import { PageHeader } from "@/components/shell/page-header";
import { liveRunsEnabled } from "@/lib/run-trace-page";

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
        {liveRunsEnabled() ? (
          <LiveRuns />
        ) : (
          <p className="text-muted-foreground text-sm">
            To see runs live as your factory pushes them, set <code>RUN_TRACE_TOKEN</code> on the web app. See{" "}
            <Link href="/docs/plug-in-your-factory" className="underline">
              Plug in your factory
            </Link>
            .
          </p>
        )}
        <RunTraceExplorer />
        {process.env.NODE_ENV === "development" ? <SparsePreview /> : null}
      </div>
    </main>
  );
}
