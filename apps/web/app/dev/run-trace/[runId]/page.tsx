import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LiveRunTrace } from "@/app/dev/run-trace/live-run-trace";
import { PageHeader } from "@/components/shell/page-header";
import { liveRunsEnabled } from "@/lib/run-trace-page";

export const metadata: Metadata = { title: "Run trace" };

export default async function LiveRunTracePage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ source?: string | string[] }>;
}) {
  if (!liveRunsEnabled()) notFound();
  const { runId } = await params;
  const { source } = await searchParams;
  return (
    <main className="mx-auto w-full max-w-[110rem] px-4 py-8">
      <PageHeader
        eyebrow="Dev"
        title="Run trace"
        description="A run pushed to the ingest API or read from a connected source. While it is live the page refreshes every few seconds."
      />
      <div className="mt-6">
        <LiveRunTrace key={`${runId}:${source}`} runId={runId} source={typeof source === "string" ? source : undefined} />
      </div>
    </main>
  );
}
