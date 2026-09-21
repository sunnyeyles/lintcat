import { EMPHASIS_MARKERS } from "@/lib/codebase-map";
import type { NeighbourDirection } from "@/lib/codebase-map";

import { markerParts } from "@/components/codebase-map/markers";

interface Entry {
  marker: string;
  direction: NeighbourDirection | null;
  colour: string;
  label: string;
}

const ENTRIES: Entry[] = [
  { marker: EMPHASIS_MARKERS.focus, direction: null, colour: "var(--ring)", label: "Focused" },
  {
    marker: EMPHASIS_MARKERS.changed,
    direction: null,
    colour: "var(--map-module-changed)",
    label: "Changed in this PR",
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
];

function Swatch({ entry }: { entry: Entry }) {
  const parts = markerParts(entry.marker, 7, entry.direction);
  return (
    <svg viewBox="-12 -12 24 24" className="size-5 shrink-0" aria-hidden="true">
      {parts.map((part, i) => (
        <path
          key={i}
          d={part.d}
          fill={part.mode === "fill" ? entry.colour : "none"}
          stroke={
            part.mode === "stroke"
              ? entry.marker === "group"
                ? "var(--map-structure-border)"
                : entry.colour
              : "none"
          }
          strokeWidth={part.width}
        />
      ))}
    </svg>
  );
}

export function MapLegend() {
  return (
    <div>
      <h3 className="text-xs font-semibold tracking-wide uppercase">Legend</h3>
      <ul className="mt-2 space-y-1.5">
        {ENTRIES.map((entry) => (
          <li key={`${entry.marker}-${entry.direction}`} className="flex items-center gap-2">
            <Swatch entry={entry} />
            <span className="text-muted-foreground text-xs">{entry.label}</span>
          </li>
        ))}
      </ul>
      <ul className="mt-3 space-y-1.5">
        <li className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true">
            <line x1="2" y1="12" x2="22" y2="12" stroke="var(--map-kind-1)" strokeWidth="2" />
          </svg>
          <span className="text-muted-foreground text-xs">Solid edge: focus → dependency</span>
        </li>
        <li className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true">
            <line
              x1="2"
              y1="12"
              x2="22"
              y2="12"
              stroke="var(--map-kind-3)"
              strokeWidth="2"
              strokeDasharray="5 4"
            />
          </svg>
          <span className="text-muted-foreground text-xs">Dashed edge: dependent → focus</span>
        </li>
      </ul>
    </div>
  );
}
