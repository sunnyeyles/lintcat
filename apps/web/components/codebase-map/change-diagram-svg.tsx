"use client";

import { cn } from "@pr-review/design";
import type { KeyboardEvent } from "react";

import type { DiagramBox, DiagramEdge, DiagramNode } from "@/lib/codebase-map";

export interface ChangeDiagramSvgProps {
  width: number;
  height: number;
  boxes: readonly DiagramBox[];
  nodes: readonly DiagramNode[];
  edges: readonly DiagramEdge[];
  onSelect?: (id: string) => void;
  /** Never scale past natural size, so a one-box diagram stays readable. */
  capped?: boolean;
}

function nodeTitle(node: DiagramNode): string {
  const findings = node.findings ?? 0;
  if (findings === 0) return node.id;
  return `${node.id} · ${findings} finding${findings === 1 ? "" : "s"}`;
}

export function ChangeDiagramSvg({
  width,
  height,
  boxes,
  nodes,
  edges,
  onSelect,
  capped = false,
}: ChangeDiagramSvgProps) {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden={onSelect ? undefined : true}
      style={capped ? { maxWidth: width } : undefined}
      className="mx-auto block h-auto w-full"
    >
      {boxes.map((box) => (
        <g key={box.label}>
          <rect
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            rx="6"
            className="fill-map-structure stroke-map-structure-border"
          />
          <text x={box.x + 10} y={box.y + 18} className="fill-muted-foreground font-mono text-[10px]">
            {box.label}
          </text>
        </g>
      ))}
      {edges.map((edge) => {
        const a = byId.get(edge.from);
        const b = byId.get(edge.to);
        if (!a || !b) return null;
        return (
          <line
            key={`${edge.from}-${edge.to}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            strokeWidth={edge.hot ? 1.5 : 1}
            className={edge.hot ? "stroke-map-module-changed/60" : "stroke-map-edge"}
          />
        );
      })}
      {nodes.map((node) => {
        const interactive = onSelect !== undefined;
        const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onSelect?.(node.id);
        };
        return (
          <g
            key={node.id}
            role={interactive ? "button" : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? `Show findings for ${nodeTitle(node)}` : undefined}
            onClick={interactive ? () => onSelect(node.id) : undefined}
            onKeyDown={interactive ? onKeyDown : undefined}
            className={cn(
              interactive &&
                "group cursor-pointer outline-none [&:focus-visible>circle:last-of-type]:stroke-ring",
            )}
          >
            {interactive ? <title>{nodeTitle(node)}</title> : null}
            {node.pulse ? (
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
              className="fill-map-label stroke-background font-mono text-[10px] [paint-order:stroke] [stroke-width:4px] group-hover:underline"
            >
              {node.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
