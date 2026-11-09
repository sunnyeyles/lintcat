import type { Metadata } from "next";

import { LiveRunTrace } from "@/app/dev/run-trace/live-run-trace";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Run trace" };

export default async function LiveRunTracePage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return (
    <main className="mx-auto w-full max-w-[110rem] px-4 py-8">
      <PageHeader
        eyebrow="Dev"
        title="Run trace"
        description="A run pushed by the Claude Code hook. While it is live the page refreshes every few seconds."
      />
      <div className="mt-6">
        <LiveRunTrace key={runId} runId={runId} />
      </div>
    </main>
  );
}
