import { Button } from "@pr-review/design";
import type { Metadata } from "next";

import { MapWorkbench } from "@/components/map/map-workbench";
import { SAMPLE_GRAPH, SAMPLE_PR } from "@/components/map/sample-graph";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Codebase map (preview)" };

export default function CodebaseMapPreviewPage() {
  return (
    <>
      <PageHeader
        eyebrow={`Pull request #${SAMPLE_PR.number}`}
        title="Codebase map"
        description="Where this change sits in the repository, what it imports and what depends on it. Sample data; the controls are for UI review and follow the user stories in issue #145."
        actions={
          <>
            <Button variant="outline" size="sm">Share view</Button>
            <Button size="sm">Open pull request</Button>
          </>
        }
      />
      <div className="mt-6">
        <MapWorkbench graph={SAMPLE_GRAPH} pr={SAMPLE_PR} />
      </div>
    </>
  );
}
