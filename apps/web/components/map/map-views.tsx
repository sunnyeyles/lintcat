"use client";

import {
  Badge,
  cn,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pr-review/design";
import { Fragment, useMemo } from "react";

import { KIND_COLOR } from "@/components/map/codebase-map";
import { FilePath } from "@/components/review/file-path";
import {
  arcLayout,
  classify,
  classifyEdges,
  clusterOf,
  type MapGraph,
  type MapView,
  neighbours,
  type NodeState,
  treemapLayout,
} from "@/lib/codebase-map";

export type MapViewProps = {
  graph: MapGraph;
  view: MapView;
  onFocus: (id: string | null) => void;
  className?: string;
};

const OPACITY: Record<NodeState, number> = { focus: 1, emphasis: 1, normal: 0.85, dim: 0.25, hidden: 0 };

const toggle = (view: MapView, id: string, onFocus: MapViewProps["onFocus"]) =>
  onFocus(view.focus === id ? null : id);

// Same files, area by size: the shape of the repo rather than its wiring.
export function TreemapView({ graph, view, onFocus, className }: MapViewProps) {
  const W = 960;
  const H = 640;
  const groups = useMemo(() => treemapLayout(graph, W, H), [graph]);
  const states = useMemo(() => classify(graph, view), [graph, view]);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      aria-label="Codebase treemap"
      className={cn("h-full w-full select-none", className)}
      onClick={() => onFocus(null)}
    >
      {groups.map((group) => (
        <g key={group.id}>
          <rect
            x={group.x + 1}
            y={group.y + 1}
            width={Math.max(0, group.width - 2)}
            height={Math.max(0, group.height - 2)}
            rx={4}
            className="fill-map-structure stroke-map-structure-border"
          />
          <text
            x={group.x + 8}
            y={group.y + 13}
            className="fill-map-label font-mono text-[10px] font-medium"
          >
            {group.id}
          </text>
          {group.cells.map((cell) => {
            const node = byId.get(cell.id);
            const state = states.get(cell.id) ?? "hidden";
            if (!node || state === "hidden" || cell.width < 1 || cell.height < 1) return null;
            const label = cell.id.slice(cell.id.lastIndexOf("/") + 1);
            const showLabel = cell.width > 56 && cell.height > 18;
            return (
              <g
                key={cell.id}
                role="button"
                tabIndex={0}
                aria-label={cell.id}
                aria-pressed={state === "focus"}
                className="cursor-pointer outline-none motion-safe:transition-opacity"
                style={{ opacity: OPACITY[state] }}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(view, cell.id, onFocus);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle(view, cell.id, onFocus);
                  }
                }}
              >
                <rect
                  x={cell.x}
                  y={cell.y}
                  width={cell.width}
                  height={cell.height}
                  rx={2}
                  fill={node.changed ? "var(--map-module-changed)" : KIND_COLOR[node.kind]}
                  fillOpacity={node.changed ? 0.9 : 0.55}
                  className={cn(
                    state === "focus" && "stroke-ring",
                    node.dead && "stroke-destructive",
                    node.cycle && view.showCycles && "stroke-warning",
                  )}
                  strokeWidth={state === "focus" ? 2.5 : node.dead || (node.cycle && view.showCycles) ? 1.5 : 0}
                  strokeDasharray={node.dead ? "3 2" : undefined}
                />
                {showLabel ? (
                  <text
                    x={cell.x + 5}
                    y={cell.y + 12}
                    className={cn("pointer-events-none font-mono text-[9px]", node.changed ? "fill-white" : "fill-map-label")}
                  >
                    {label}
                  </text>
                ) : (
                  <title>{cell.id}</title>
                )}
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}

// Same edges, drawn as arcs over one ordered axis: distance means "how far apart in the tree".
export function ArcView({ graph, view, onFocus, className }: MapViewProps) {
  const W = 960;
  const H = 400;
  const baseline = H - 70;
  const { positions, groups } = useMemo(() => arcLayout(graph, W, 24), [graph]);
  const states = useMemo(() => classify(graph, view), [graph, view]);
  const edgeStates = useMemo(() => classifyEdges(graph, states, view), [graph, states, view]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      aria-label="Import arcs"
      className={cn("h-full w-full select-none", className)}
      onClick={() => onFocus(null)}
    >
      {groups.map((g, i) => (
        <g key={g.id} aria-hidden>
          <rect
            x={g.from - 6}
            y={baseline + 10}
            width={g.to - g.from + 12}
            height={6}
            rx={3}
            className={i % 2 ? "fill-map-structure-border" : "fill-map-structure"}
          />
          {g.to - g.from > 40 ? (
            <text
              x={(g.from + g.to) / 2}
              y={baseline + 30}
              textAnchor="middle"
              className="fill-map-label font-mono text-[9px]"
            >
              {g.id}
            </text>
          ) : null}
        </g>
      ))}
      <g fill="none" aria-hidden>
        {graph.edges.map((edge, i) => {
          const a = positions.get(edge.from);
          const b = positions.get(edge.to);
          const state = edgeStates[i];
          if (a === undefined || b === undefined || state === "hidden") return null;
          const r = Math.abs(b - a) / 2;
          const lift = Math.min(r, baseline - 12);
          return (
            <path
              key={`${edge.from}->${edge.to}`}
              d={`M${a} ${baseline} A${r} ${lift} 0 0 ${a < b ? 1 : 0} ${b} ${baseline}`}
              className={cn(
                "motion-safe:transition-opacity",
                state === "emphasis" && "stroke-map-module-changed opacity-90",
                state === "normal" && "stroke-map-edge opacity-70",
                state === "dim" && "stroke-map-edge opacity-15",
              )}
              strokeWidth={state === "emphasis" ? 1.5 : 1}
            />
          );
        })}
      </g>
      {graph.nodes.map((node) => {
        const x = positions.get(node.id);
        const state = states.get(node.id) ?? "hidden";
        if (x === undefined || state === "hidden") return null;
        const r = 2.5 + Math.sqrt(node.size) * 1.2;
        return (
          <g
            key={node.id}
            role="button"
            tabIndex={0}
            aria-label={node.id}
            aria-pressed={state === "focus"}
            className="cursor-pointer outline-none motion-safe:transition-opacity"
            style={{ opacity: OPACITY[state] }}
            onClick={(e) => {
              e.stopPropagation();
              toggle(view, node.id, onFocus);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle(view, node.id, onFocus);
              }
            }}
          >
            {state === "focus" ? <circle cx={x} cy={baseline} r={r + 4} className="fill-none stroke-ring" strokeWidth={2} /> : null}
            <circle
              cx={x}
              cy={baseline}
              r={r}
              fill={node.changed ? "var(--map-module-changed)" : KIND_COLOR[node.kind]}
              className={cn(node.dead && "stroke-destructive", node.cycle && view.showCycles && "stroke-warning")}
              strokeWidth={node.dead || (node.cycle && view.showCycles) ? 1.5 : 0}
              strokeDasharray={node.dead ? "2 2" : undefined}
            />
            <title>{node.id}</title>
          </g>
        );
      })}
    </svg>
  );
}

// Same graph as rows: the dense, scannable form a reviewer would export.
export function ListView({ graph, view, onFocus, className }: MapViewProps) {
  const states = useMemo(() => classify(graph, view), [graph, view]);
  const rows = useMemo(
    () =>
      [...graph.nodes]
        .filter((n) => states.get(n.id) !== "hidden")
        .sort((a, b) => a.id.localeCompare(b.id)),
    [graph, states],
  );
  let lastCluster = "";

  return (
    <div className={cn("overflow-auto", className)}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>File</TableHead>
            <TableHead className="w-24">Kind</TableHead>
            <TableHead className="w-20 text-right">Imports</TableHead>
            <TableHead className="w-24 text-right">Imported by</TableHead>
            <TableHead className="w-40">Flags</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((node) => {
            const state = states.get(node.id) ?? "normal";
            const { imports, importedBy } = neighbours(graph, node.id);
            const cluster = clusterOf(node.id);
            const header = cluster !== lastCluster;
            lastCluster = cluster;
            return (
              <Fragment key={node.id}>
                {header ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="bg-muted py-1.5 font-mono text-xs font-medium text-muted-foreground">
                      {cluster}
                    </TableCell>
                  </TableRow>
                ) : null}
                <TableRow
                  data-state={state === "focus" ? "selected" : undefined}
                  aria-selected={state === "focus"}
                  className={cn("cursor-pointer", state === "dim" && "opacity-50")}
                  onClick={() => toggle(view, node.id, onFocus)}
                >
                  <TableCell className="max-w-0">
                    <FilePath file={node.id} className="text-sm" />
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: KIND_COLOR[node.kind] }} />
                      {node.kind}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{imports.length}</TableCell>
                  <TableCell className="text-right tabular-nums">{importedBy.length}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {node.changed ? <Badge variant="attention">Changed</Badge> : null}
                      {node.cycle && view.showCycles ? <Badge variant="outline" className="border-warning/40 text-warning">Cycle</Badge> : null}
                      {node.dead ? <Badge variant="outline" className="border-destructive/40 text-destructive">Unreferenced</Badge> : null}
                    </span>
                  </TableCell>
                </TableRow>
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
