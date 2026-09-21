import type { Metadata } from "next";

import { SpikeClient } from "@/app/dev/codebase-map/spike/spike-client";

export const metadata: Metadata = { title: "Codebase map rendering spike" };

export default function CodebaseMapSpikePage() {
  return (
    <main className="mx-auto w-full max-w-[86rem] px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Codebase map rendering spike</h1>
      <p className="text-muted-foreground mt-2 max-w-prose text-sm">
        The seeded sample repo with every group expanded, drawn three ways. Run pan/zoom to time
        the gap between painted frames.
      </p>
      <div className="mt-6">
        <SpikeClient />
      </div>
    </main>
  );
}
