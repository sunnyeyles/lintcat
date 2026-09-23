import { Badge, Card, cn } from "@pr-review/design";

type Box = { label: string; x: number; y: number; w: number; h: number };
type Node = { id: string; label: string; x: number; y: number; changed?: boolean };

const BOXES: Box[] = [
  { label: "apps/web", x: 16, y: 24, w: 208, h: 272 },
  { label: "packages/reviewer", x: 256, y: 24, w: 208, h: 148 },
  { label: "packages/index", x: 256, y: 196, w: 208, h: 100 },
  { label: "packages/github", x: 496, y: 24, w: 208, h: 124 },
  { label: "packages/db", x: 496, y: 172, w: 208, h: 124 },
];

const NODES: Node[] = [
  { id: "page", label: "page.tsx", x: 72, y: 92 },
  { id: "review", label: "review/", x: 160, y: 124 },
  { id: "docs", label: "docs.ts", x: 84, y: 196 },
  { id: "webhook", label: "webhook", x: 164, y: 244 },
  { id: "agent", label: "agent.ts", x: 312, y: 84, changed: true },
  { id: "validate", label: "validate.ts", x: 412, y: 76 },
  { id: "tools", label: "tools.ts", x: 376, y: 136, changed: true },
  { id: "graph", label: "graph.ts", x: 312, y: 256 },
  { id: "symbols", label: "symbols.ts", x: 412, y: 256, changed: true },
  { id: "client", label: "client.ts", x: 556, y: 92 },
  { id: "checks", label: "checks.ts", x: 648, y: 112 },
  { id: "schema", label: "schema.ts", x: 556, y: 244 },
  { id: "queries", label: "queries.ts", x: 648, y: 228 },
];

const EDGES: [string, string][] = [
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
];

const byId = new Map(NODES.map((node) => [node.id, node]));
const touchesChange = (from: string, to: string) =>
  Boolean(byId.get(from)?.changed || byId.get(to)?.changed);

export function MapPreview({ className }: { className?: string }) {
  return (
    <Card className={cn("gap-0 overflow-hidden py-0 shadow-lg", className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface-2 px-4 py-2.5">
        <span className="font-mono text-caption text-muted-foreground">
          Review · feat: batch symbol lookups
        </span>
        <div className="ml-auto flex items-center gap-3 text-caption text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-map-module" />
            Module
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-map-module-changed" />
            Changed in this PR
          </span>
          <Badge variant="outline" className="hidden sm:inline-flex">
            3 files · 2 findings
          </Badge>
        </div>
      </div>
      <p className="sr-only">
        An example codebase map: five packages, the modules inside them, and the imports between
        them, with the three modules a pull request changed highlighted.
      </p>
      <svg viewBox="0 0 720 320" aria-hidden className="block h-auto w-full bg-background">
        {BOXES.map((box) => (
          <g key={box.label}>
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx="6"
              className="fill-map-structure stroke-map-structure-border"
            />
            <text
              x={box.x + 10}
              y={box.y + 18}
              className="fill-muted-foreground font-mono text-[10px]"
            >
              {box.label}
            </text>
          </g>
        ))}
        {EDGES.map(([from, to]) => {
          const a = byId.get(from);
          const b = byId.get(to);
          if (!a || !b) return null;
          const hot = touchesChange(from, to);
          return (
            <line
              key={`${from}-${to}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              strokeWidth={hot ? 1.5 : 1}
              className={hot ? "stroke-map-module-changed/60" : "stroke-map-edge"}
            />
          );
        })}
        {NODES.map((node) => (
          <g key={node.id}>
            {node.changed ? (
              <circle
                cx={node.x}
                cy={node.y}
                r="7"
                className="origin-center animate-ping motion-reduce:hidden fill-map-module-changed/40 [animation-duration:2.4s] [transform-box:fill-box]"
              />
            ) : null}
            <circle
              cx={node.x}
              cy={node.y}
              r="7"
              className={cn(
                "stroke-background stroke-2",
                node.changed ? "fill-map-module-changed" : "fill-map-module",
              )}
            />
            <text
              x={node.x}
              y={node.y + 22}
              textAnchor="middle"
              className="fill-map-label stroke-background font-mono text-[10px] [paint-order:stroke] [stroke-width:4px]"
            >
              {node.label}
            </text>
          </g>
        ))}
      </svg>
    </Card>
  );
}
