import { ChangeDiagramSvg } from "@/components/codebase-map/change-diagram-svg";
import { DiagramFrame } from "@/components/codebase-map/diagram-frame";
import type { DiagramBox, DiagramEdge, DiagramNode } from "@/lib/codebase-map";

const BOXES: DiagramBox[] = [
  { label: "apps/web", x: 16, y: 24, w: 208, h: 272 },
  { label: "packages/reviewer", x: 256, y: 24, w: 208, h: 148 },
  { label: "packages/index", x: 256, y: 196, w: 208, h: 100 },
  { label: "packages/github", x: 496, y: 24, w: 208, h: 124 },
  { label: "packages/db", x: 496, y: 172, w: 208, h: 124 },
];

const NODES: DiagramNode[] = [
  { id: "page", label: "page.tsx", x: 72, y: 92 },
  { id: "review", label: "review/", x: 160, y: 124 },
  { id: "docs", label: "docs.ts", x: 84, y: 196 },
  { id: "webhook", label: "webhook", x: 164, y: 244 },
  { id: "agent", label: "agent.ts", x: 312, y: 84, changed: true, pulse: true },
  { id: "validate", label: "validate.ts", x: 412, y: 76 },
  { id: "tools", label: "tools.ts", x: 376, y: 136, changed: true, pulse: true },
  { id: "graph", label: "graph.ts", x: 312, y: 256 },
  { id: "symbols", label: "symbols.ts", x: 412, y: 256, changed: true, pulse: true },
  { id: "client", label: "client.ts", x: 556, y: 92 },
  { id: "checks", label: "checks.ts", x: 648, y: 112 },
  { id: "schema", label: "schema.ts", x: 556, y: 244 },
  { id: "queries", label: "queries.ts", x: 648, y: 228 },
];

const changed = new Set(NODES.filter((node) => node.changed).map((node) => node.id));

const EDGES: DiagramEdge[] = (
  [
    ["page", "docs"],
    ["page", "review"],
    ["review", "queries"],
    ["webhook", "agent"],
    ["webhook", "client"],
    ["agent", "tools"],
    ["agent", "validate"],
    ["tools", "graph"],
    ["tools", "symbols"],
    ["graph", "symbols"],
    ["validate", "checks"],
    ["checks", "client"],
    ["queries", "schema"],
  ] as const
).map(([from, to]) => ({ from, to, hot: changed.has(from) || changed.has(to) }));

export function MapPreview({ className }: { className?: string }) {
  return (
    <DiagramFrame
      className={className}
      title="Review · feat: batch symbol lookups"
      badge="3 files · 2 findings"
      description="An example codebase map: five packages, the modules inside them, and the imports between them, with the three modules a pull request changed highlighted."
    >
      <ChangeDiagramSvg width={720} height={320} boxes={BOXES} nodes={NODES} edges={EDGES} />
    </DiagramFrame>
  );
}
