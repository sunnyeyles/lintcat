import { Label, Switch } from "@pr-review/design";
import { useId } from "react";

import { EMPHASIS_MARKERS } from "@/lib/codebase-map";
import type { NeighbourDirection } from "@/lib/codebase-map";

import {
  DEAD_DASH,
  EDGE_STYLES,
  markerParts,
  QUIET_ALPHA,
  QUIET_SCALE,
  type EdgeClass,
} from "@/components/codebase-map/markers";

interface Entry {
  marker: string;
  direction: NeighbourDirection | null;
  colour: string;
  stroke?: string;
  label: string;
  /** Listed only while the map has impacted files. */
  impacted?: true;
  dead?: true;
  quiet?: true;
}

const ENTRIES: Entry[] = [
  { marker: EMPHASIS_MARKERS.focus, direction: null, colour: "var(--ring)", label: "Focused" },
  {
    marker: EMPHASIS_MARKERS.changed,
    direction: null,
    colour: "var(--map-module-changed)",
    label: "Changed in this PR (modified)",
  },
  { marker: "plus", direction: null, colour: "var(--success)", label: "Added by this PR" },
  { marker: "cross", direction: null, colour: "var(--destructive)", label: "Removed by this PR" },
  {
    marker: "filled-diamond",
    direction: null,
    colour: "var(--map-module-changed)",
    label: "Renamed by this PR, drawn at its new path",
  },
  {
    marker: `${EMPHASIS_MARKERS.reached}-1`,
    direction: null,
    colour: "var(--map-kind-2)",
    label: "Reached: imports the change directly",
  },
  {
    marker: `${EMPHASIS_MARKERS.reached}-2`,
    direction: null,
    colour: "var(--map-kind-2)",
    label: "Reached in two import steps",
  },
  {
    marker: `${EMPHASIS_MARKERS.reached}-3`,
    direction: null,
    colour: "var(--map-kind-2)",
    label: "Reached in three import steps",
  },
  {
    marker: EMPHASIS_MARKERS.impacted,
    direction: null,
    colour: "var(--map-module-impacted)",
    label: "Impacted: depends on the change",
    impacted: true,
  },
  {
    marker: EMPHASIS_MARKERS.neighbour,
    direction: "dependency",
    colour: "var(--map-kind-1)",
    label: "Dependency (focus imports it)",
  },
  {
    marker: EMPHASIS_MARKERS.neighbour,
    direction: "dependent",
    colour: "var(--map-kind-3)",
    label: "Dependent (imports the focus)",
  },
  {
    marker: EMPHASIS_MARKERS.context,
    direction: null,
    colour: "var(--map-module)",
    label: "Other file",
  },
  {
    marker: EMPHASIS_MARKERS.context,
    direction: null,
    colour: "var(--map-module)",
    label: "Dead: nothing imports it (dashed outline)",
    dead: true,
  },
  {
    marker: EMPHASIS_MARKERS.context,
    direction: null,
    colour: "var(--map-module)",
    label: "Test or fixture (smaller and fainter)",
    quiet: true,
  },
  {
    marker: EMPHASIS_MARKERS.dimmed,
    direction: null,
    colour: "var(--map-edge)",
    label: "Dimmed by the current focus or search",
  },
  {
    marker: "group",
    direction: null,
    colour: "var(--map-structure)",
    label: "Collapsed package directory",
  },
  {
    marker: "group",
    direction: null,
    colour: "var(--map-structure)",
    stroke: "var(--map-module-impacted)",
    label: "Collapsed directory holding impacted files",
    impacted: true,
  },
];

const EDGES: { kind: EdgeClass; label: string }[] = [
  { kind: "dependency", label: "Focus → dependency" },
  { kind: "dependent", label: "Dependent → focus" },
  { kind: "cycle", label: "Closes an import cycle" },
  { kind: "added", label: "Import the PR adds" },
  { kind: "removed", label: "Import the PR removes" },
];

function Swatch({ entry }: { entry: Entry }) {
  const radius = entry.quiet ? 7 * QUIET_SCALE : 7;
  const parts = markerParts(entry.marker, radius, entry.direction);
  return (
    <svg viewBox="-12 -12 24 24" className="size-5 shrink-0" aria-hidden="true">
      <g opacity={entry.quiet ? QUIET_ALPHA : 1}>
        {parts.map((part, i) => (
          <path
            key={i}
            d={part.d}
            fill={part.mode === "fill" ? entry.colour : "none"}
            stroke={
              part.mode === "stroke"
                ? (entry.stroke ??
                  (entry.marker === "group" ? "var(--map-structure-border)" : entry.colour))
                : "none"
            }
            strokeWidth={part.width}
          />
        ))}
      </g>
      {entry.dead ? (
        <path
          d={markerParts("dead", radius)[0]!.d}
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth={1}
          strokeDasharray={DEAD_DASH.join(" ")}
        />
      ) : null}
    </svg>
  );
}

const HEAT: { colour: string; label: string }[] = [
  { colour: "var(--severity-high)", label: "Worst finding is high" },
  { colour: "var(--severity-medium)", label: "Worst finding is medium" },
  { colour: "var(--severity-low)", label: "Worst finding is low" },
];

interface ImpactedOverlay {
  shown: boolean;
  onShownChange: (shown: boolean) => void;
}

export function MapLegend({
  impacted,
}: {
  /** Absent when no file depends on the change, which leaves the legend as it was. */
  impacted?: ImpactedOverlay;
}) {
  const switchId = useId();
  const entries = impacted ? ENTRIES : ENTRIES.filter((entry) => !entry.impacted);
  return (
    <div>
      <h3 className="text-xs font-semibold tracking-wide uppercase">Legend</h3>
      {impacted ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <Label htmlFor={switchId} className="text-xs font-normal">
            Show files that depend on the change
          </Label>
          <Switch
            id={switchId}
            size="sm"
            checked={impacted.shown}
            onCheckedChange={impacted.onShownChange}
          />
        </div>
      ) : null}
      <ul className="mt-2 space-y-1.5">
        {entries.map((entry) => (
          <li key={entry.label} className="flex items-center gap-2">
            <Swatch entry={entry} />
            <span className="text-muted-foreground text-xs">{entry.label}</span>
          </li>
        ))}
      </ul>
      <ul className="mt-3 space-y-1.5">
        {EDGES.map(({ kind, label }) => {
          const style = EDGE_STYLES[kind];
          return (
            <li key={kind} className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true">
                <line
                  x1="2"
                  y1="12"
                  x2="22"
                  y2="12"
                  stroke={`var(${style.token})`}
                  strokeWidth={style.width + 0.4}
                  strokeDasharray={style.dash.length > 0 ? style.dash.join(" ") : undefined}
                />
              </svg>
              <span className="text-muted-foreground text-xs">{label}</span>
            </li>
          );
        })}
      </ul>
      <ul className="mt-3 space-y-1.5">
        {HEAT.map((entry, i) => (
          <li key={entry.label} className="flex items-center gap-2">
            <svg viewBox="-12 -12 24 24" className="size-5 shrink-0" aria-hidden="true">
              <circle r="9" fill="none" stroke={entry.colour} strokeWidth={2.5 - i * 0.75} />
              <circle r="3" fill="var(--map-module)" />
            </svg>
            <span className="text-muted-foreground text-xs">{entry.label}</span>
          </li>
        ))}
        <li className="text-muted-foreground text-xs">
          The ring thickens and the number beside it grows with the finding count.
        </li>
      </ul>
    </div>
  );
}
