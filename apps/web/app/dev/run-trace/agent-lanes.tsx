"use client";

import { Badge, Button, Card, cn } from "@pr-review/design";
import { ChevronDown, ChevronRight } from "@pr-review/design/icons";
import { useMemo, useState } from "react";

import {
  activityLabel,
  agentStats,
  axisTicks,
  barSpan,
  formatDuration,
  formatTokens,
  fraction,
  isRunning,
  roleColor,
  timeBounds,
  toolTimes,
  visibleRows,
  type LaneRow,
  type TimeBounds,
} from "@/app/dev/run-trace/trace-layout";
import type { AgentNode } from "@/lib/run-trace/types";

const ZOOMS = [1, 2, 4, 8] as const;
const TREE_WIDTH = "19rem";

const pct = (f: number) => `${(f * 100).toFixed(3)}%`;

export function AgentLanes({
  root,
  collapsed,
  selectedId,
  onSelect,
  onToggle,
  live = false,
}: {
  root: AgentNode;
  collapsed: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  live?: boolean;
}) {
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const rows = useMemo(() => visibleRows(root, collapsed), [root, collapsed]);
  const bounds = useMemo(() => timeBounds(root), [root]);
  const ticks = useMemo(() => axisTicks(bounds, 8 * zoom), [bounds, zoom]);

  return (
    <Card className="min-w-0 gap-0 self-start overflow-hidden py-0">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
        <h2 className="text-sm font-semibold">Agents and timeline</h2>
        <div className="flex items-center gap-1" role="group" aria-label="Timeline zoom">
          {ZOOMS.map((z) => (
            <Button
              key={z}
              size="xs"
              variant={z === zoom ? "default" : "ghost"}
              aria-pressed={z === zoom}
              onClick={() => setZoom(z)}
            >
              {z}×
            </Button>
          ))}
        </div>
      </div>
      <div className="max-h-[72vh] overflow-auto">
        <div
          style={{
            width: zoom === 1 ? "100%" : `calc(${TREE_WIDTH} + ${zoom} * (100% - ${TREE_WIDTH}))`,
            gridTemplateColumns: `${TREE_WIDTH} minmax(0, 1fr)`,
          }}
          className="grid"
        >
          <div className="bg-card text-muted-foreground sticky top-0 left-0 z-30 border-r border-b px-3 py-1.5 text-xs">
            Agent · duration · activity · peak context
          </div>
          <div className="bg-card sticky top-0 z-20 h-7 border-b">
            {ticks.map((t) => (
              <span
                key={t}
                className="text-muted-foreground absolute top-1.5 pl-1 text-[0.6875rem] tabular-nums"
                style={{ left: pct(t / (bounds.end - bounds.start)) }}
              >
                {formatDuration(t)}
              </span>
            ))}
          </div>
          {rows.map((row) => (
            <LaneRowView
              key={row.node.id}
              row={row}
              bounds={bounds}
              ticks={ticks}
              selected={row.node.id === selectedId}
              live={live}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

function LaneRowView({
  row,
  bounds,
  ticks,
  selected,
  live,
  onSelect,
  onToggle,
}: {
  row: LaneRow;
  bounds: TimeBounds;
  ticks: number[];
  selected: boolean;
  live: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const { node, depth, hasChildren, collapsed } = row;
  const stats = agentStats(node);
  const color = roleColor(node.role);
  const span = barSpan(node, bounds);
  const tools = toolTimes(node);
  const label = node.description ? `${node.role}: ${node.description}` : node.role;
  const tint = selected ? "bg-accent" : "bg-card";

  return (
    <>
      <div
        className={cn("sticky left-0 z-10 flex h-11 items-center gap-1 border-r border-b pr-2", tint)}
        style={{ paddingLeft: `calc(0.5rem + ${depth} * 0.875rem)` }}
      >
        {hasChildren ? (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={collapsed ? `Expand ${node.role}` : `Collapse ${node.role}`}
            aria-expanded={!collapsed}
            onClick={() => onToggle(node.id)}
          >
            {collapsed ? <ChevronRight animate="none" /> : <ChevronDown animate="none" />}
          </Button>
        ) : (
          <span className="size-6 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          aria-current={selected ? "true" : undefined}
          title={label}
          className="focus-visible:ring-ring/50 flex min-w-0 flex-1 flex-col items-start rounded-sm text-left outline-none focus-visible:ring-[3px]"
        >
          <span className="flex w-full min-w-0 items-center gap-1.5 text-sm">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <span className="shrink-0 font-medium">{node.role}</span>
            {node.description ? (
              <span className="text-muted-foreground truncate text-xs">{node.description}</span>
            ) : null}
            {live && isRunning(node) ? (
              <Badge variant="secondary" className="ml-auto shrink-0">
                running
              </Badge>
            ) : node.status === "failed" ? (
              <Badge variant="destructive" className="ml-auto shrink-0">
                failed
              </Badge>
            ) : null}
          </span>
          <span className="text-muted-foreground pl-3.5 text-xs tabular-nums">
            {formatDuration(stats.durationMs)} · {activityLabel(stats)} · {formatTokens(stats.peakContext)}
            {collapsed ? ` · +${node.children.length} hidden` : ""}
          </span>
        </button>
      </div>
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        aria-label={`Select ${label}`}
        className={cn("relative h-11 border-b outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", selected ? "bg-accent" : "hover:bg-surface-2")}
      >
        {ticks.map((t) => (
          <span
            key={t}
            className="border-border-subtle absolute inset-y-0 border-l"
            style={{ left: pct(t / (bounds.end - bounds.start)) }}
          />
        ))}
        <span
          className={cn("absolute inset-y-2 rounded-sm border", selected && "ring-ring ring-2")}
          style={{
            left: pct(span.left),
            width: `max(3px, ${pct(span.width)})`,
            borderColor: color,
            backgroundColor: `color-mix(in oklab, ${color} 22%, transparent)`,
          }}
        />
        {tools.map((tool) => (
          <span
            key={tool.id}
            title={tool.label}
            className={cn("absolute inset-y-3 w-px", tool.error && "bg-destructive")}
            style={{ left: pct(fraction(tool.ms, bounds)), backgroundColor: tool.error ? undefined : color }}
          />
        ))}
      </button>
    </>
  );
}
