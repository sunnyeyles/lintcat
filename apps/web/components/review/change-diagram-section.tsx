import {
  Card,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
} from "@pr-review/design";
import { MapPinOff } from "@pr-review/design/icons";
import type { ReviewRecordChangedFile } from "@pr-review/schemas";
import type { ReactNode } from "react";

import { DiagramFrame } from "@/components/codebase-map/diagram-frame";
import { SectionHeading } from "@/components/ui";
import { changeDiagram, type ChangeDiagram, type MapSource } from "@/lib/codebase-map";

import { ReviewChangeDiagram } from "./change-diagram";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function describe(diagram: ChangeDiagram, graphed: boolean): string {
  const drawn = diagram.nodes.length - diagram.neighbourCount;
  const where = `across ${plural(diagram.boxes.length, "package")}`;
  if (!graphed) return `${plural(drawn, "changed file")} ${where}. No import graph was stored.`;
  return `${plural(drawn, "changed file")} ${where}, with ${plural(diagram.neighbourCount, "file")} they import or are imported by.`;
}

function ChangeSection({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="change-heading" className="flex flex-col gap-4">
      <SectionHeading id="change-heading" title="Change" />
      {children}
    </section>
  );
}

const nothingDrawn = (
  <ChangeSection>
    <Empty className="rounded-lg border border-dashed border-border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MapPinOff />
        </EmptyMedia>
        <EmptyTitle>No changed files to draw</EmptyTitle>
        <EmptyDescription>This review stored no changed files for its diff.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  </ChangeSection>
);

export function ChangeDiagramSkeleton() {
  return (
    <ChangeSection>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b border-border bg-surface-2 px-4 py-2.5">
          <Skeleton className="ml-auto h-4 w-48" />
        </div>
        <Skeleton className="h-60 w-full rounded-none" />
      </Card>
    </ChangeSection>
  );
}

export async function ChangeDiagramSection({
  source,
  changedFiles,
  findingCount,
}: {
  source: Promise<MapSource>;
  changedFiles: readonly ReviewRecordChangedFile[];
  findingCount: number;
}) {
  if (changedFiles.length === 0) return nothingDrawn;
  const { graph, heat } = await source;
  const diagram = changeDiagram({ graph, changedFiles, heat });
  if (diagram.nodes.length === 0) return nothingDrawn;

  const notes = [
    diagram.hiddenChanged > 0 ? `${plural(diagram.hiddenChanged, "more changed file")} not drawn` : null,
    graph === undefined ? "No import graph for this review, so imports are not drawn" : null,
  ].filter(Boolean);

  return (
    <ChangeSection>
      <DiagramFrame
        badge={`${plural(changedFiles.length, "file")} · ${plural(findingCount, "finding")}`}
        description={describe(diagram, graph !== undefined)}
        footer={notes.length > 0 ? notes.join(" · ") : undefined}
        className="shadow-none"
      >
        <ReviewChangeDiagram diagram={diagram} />
      </DiagramFrame>
    </ChangeSection>
  );
}
