import type { Metadata } from "next";
import Link from "next/link";

import { MapExplorer } from "@/app/dev/codebase-map/map-explorer";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Codebase map" };

export default function CodebaseMapDevPage() {
  return (
    <main className="mx-auto w-full max-w-[96rem] px-4 py-8">
      <PageHeader
        eyebrow="Dev"
        title="Codebase map"
        description="The seeded sample repo, drawn from the pure view-model module. Click or focus a file to see what it imports and what imports it; press / to search."
        actions={
          <Link
            href="/dev/codebase-map/spike"
            className="focus-visible:ring-ring text-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
          >
            Rendering spike
          </Link>
        }
      />
      <div className="mt-6">
        <MapExplorer />
      </div>
    </main>
  );
}
