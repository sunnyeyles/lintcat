"use client";

import { cn } from "@pr-review/design";
import { useMemo } from "react";

import {
  classify,
  classifyEdges,
  type FileKind,
  layout,
  type MapGraph,
  type MapView,
  type NodeState,
} from "@/lib/codebase-map-view";

export const KIND_COLOR: Record<FileKind, string> = {
  source: "var(--map-module)",
  test: "var(--map-kind-1)",
  config: "var(--map-kind-2)",
  docs: "var(--map-kind-3)",
};

const WIDTH = 960;
const HEIGHT = 640;

const NODE_CLASS: Record<NodeState, string> = {
  focus: "opacity-100",
  emphasis: "opacity-100",
  normal: "opacity-90",
  dim: "opacity-25",
  hidden: "hidden",
};

export type CodebaseMapProps = {
  graph: MapGraph;
  view: MapView;
  zoom: number;
  onFocus: (id: string | null) => void;
  className?: string;
};

export function CodebaseMap({ graph, view, zoom, onFocus, className }: CodebaseMapProps) {
  const { positions, clusters } = useMemo(() => layout(graph, WIDTH, HEIGHT), [graph]);
  const nodeStates = useMemo(() => classify(graph, view), [graph, view]);
  const edgeStates = useMemo(() => classifyEdges(graph, nodeStates, view), [graph, nodeStates, view]);
  const labelled = new Set(
    [...nodeStates].filter(([, s]) => s === "focus" || s === "emphasis").map(([id]) => id),
  );

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="group"
      aria-label="Codebase map"
      className={cn("h-full w-full select-none", className)}
      onClick={() => onFocus(null)}
    >
      <g
        transform={`translate(${WIDTH / 2} ${HEIGHT / 2}) scale(${zoom}) translate(${-WIDTH / 2} ${-HEIGHT / 2})`}
        className="motion-safe:transition-transform motion-safe:duration-300"
      >
        {clusters.map((cluster) => (
          <g key={cluster.id} aria-hidden>
            <circle
              cx={cluster.centre.x}
              cy={cluster.centre.y}
              r={cluster.radius}
              className="fill-map-structure stroke-map-structure-border"
              strokeWidth={1}
            />
            <text
              x={cluster.centre.x}
              y={cluster.centre.y - cluster.radius - 6}
              textAnchor="middle"
              className="fill-map-label font-mono text-[11px]"
            >
              {cluster.id}
            </text>
          </g>
        ))}
        <g fill="none" aria-hidden>
          {graph.edges.map((edge, i) => {
            const a = positions.get(edge.from);
            const b = positions.get(edge.to);
            const state = edgeStates[i];
            if (!a || !b || state === "hidden") return null;
            const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.15;
            const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.15;
            return (
              <path
                key={`${edge.from}->${edge.to}`}
                d={`M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`}
                className={cn(
                  "motion-safe:transition-opacity",
                  state === "emphasis" && "stroke-map-module-changed opacity-90",
                  state === "normal" && "stroke-map-edge opacity-80",
                  state === "dim" && "stroke-map-edge opacity-20",
                )}
                strokeWidth={state === "emphasis" ? 1.5 : 1}
              />
            );
          })}
        </g>
        {graph.nodes.map((node) => {
          const p = positions.get(node.id);
          const state = nodeStates.get(node.id) ?? "hidden";
          if (!p || state === "hidden") return null;
          const r = 3 + Math.sqrt(node.size) * 1.6;
          const label = node.id.slice(node.id.lastIndexOf("/") + 1);
          return (
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              aria-label={`${node.id}${node.changed ? ", changed" : ""}${node.dead ? ", unreferenced" : ""}${node.cycle ? ", in an import cycle" : ""}`}
              aria-pressed={state === "focus"}
              className={cn("cursor-pointer outline-none motion-safe:transition-opacity", NODE_CLASS[state])}
              onClick={(event) => {
                event.stopPropagation();
                onFocus(state === "focus" ? null : node.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onFocus(state === "focus" ? null : node.id);
                }
              }}
            >
              {state === "focus" ? (
                <circle cx={p.x} cy={p.y} r={r + 5} className="fill-none stroke-ring" strokeWidth={2} />
              ) : null}
              {node.cycle && view.showCycles ? (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r + 3}
                  className="fill-none stroke-warning"
                  strokeWidth={1.5}
                  strokeDasharray="3 2"
                />
              ) : null}
              <circle
                cx={p.x}
                cy={p.y}
                r={r}
                fill={node.changed ? "var(--map-module-changed)" : KIND_COLOR[node.kind]}
                className={cn(node.dead && "stroke-destructive")}
                strokeWidth={node.dead ? 2 : 0}
                strokeDasharray={node.dead ? "2 2" : undefined}
              />
              {node.changed ? (
                <circle cx={p.x} cy={p.y} r={Math.max(1.5, r - 3)} className="fill-background" />
              ) : null}
              {labelled.has(node.id) ? (
                <text
                  x={p.x + r + 4}
                  y={p.y + 3.5}
                  className="pointer-events-none fill-map-label font-mono text-[10px]"
                >
                  {label}
                </text>
              ) : (
                <title>{node.id}</title>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
