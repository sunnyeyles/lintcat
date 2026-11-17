import type { Metadata } from "next";

import { FactoryBoard } from "@/app/dev/factory/factory-board";
import { PageHeader } from "@/components/shell/page-header";
import { liveRunsEnabled } from "@/lib/run-trace-page";

export const metadata: Metadata = { title: "Factory" };

export default function FactoryDevPage() {
  return (
    <main className="mx-auto w-full max-w-[110rem] px-4 py-8">
      <PageHeader
        eyebrow="Dev"
        title="Factory"
        description="Every factory run, with the ones in progress shown as the character working their current stage. Open a run to see each agent and command."
      />
      <div className="mt-6">
        {liveRunsEnabled() ? (
          <FactoryBoard />
        ) : (
          <p className="text-muted-foreground text-sm">
            To see factory runs, set <code>RUN_TRACE_TOKEN</code> and <code>FACTORY_DATABASE_URL</code> on the web app.
          </p>
        )}
      </div>
    </main>
  );
}
