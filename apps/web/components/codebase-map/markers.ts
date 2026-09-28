import type { MapPalette } from "@/components/codebase-map/palette";
import type { NeighbourDirection } from "@/lib/codebase-map";

interface EdgeStyle {
  token: keyof MapPalette;
  width: number;
  dash: readonly number[];
}

/** Every drawn edge class, so the canvas and the legend read one table. */
export const EDGE_STYLES = {
  dependency: { token: "--map-kind-1", width: 1.6, dash: [] },
  dependent: { token: "--map-kind-3", width: 1.6, dash: [5, 4] },
  cycle: { token: "--warning", width: 1.4, dash: [10, 3, 2, 3] },
  added: { token: "--success", width: 1.2, dash: [9, 3] },
  removed: { token: "--destructive", width: 1.2, dash: [1.5, 3] },
} as const satisfies Record<string, EdgeStyle>;

export type EdgeClass = keyof typeof EDGE_STYLES;

/** The dashed outline a dead file gets on top of its own marker. */
export const DEAD_DASH = [2, 2] as const;

/** Tests draw smaller and fainter, at the same emphasis level. */
export const QUIET_SCALE = 0.75;
export const QUIET_ALPHA = 0.55;

export interface MarkerPart {
  d: string;
  mode: "fill" | "stroke";
  width: number;
}

function circle(r: number): string {
  const n = -r;
  return `M ${n} 0 A ${r} ${r} 0 1 0 ${r} 0 A ${r} ${r} 0 1 0 ${n} 0 Z`;
}

function polygon(points: readonly (readonly [number, number])[], close = true): string {
  const body = points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
  return close ? `${body} Z` : body;
}

function hexagon(r: number): string {
  const points: [number, number][] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    points.push([
      Math.round(r * Math.cos(angle) * 100) / 100,
      Math.round(r * Math.sin(angle) * 100) / 100,
    ]);
  }
  return polygon(points);
}

// Filled at one step, hollow at two, small and thin at three: depth reads without colour.
function triangle(r: number): string {
  return polygon([
    [0, -r * 1.15],
    [r * 1.05, r * 0.8],
    [-r * 1.05, r * 0.8],
  ]);
}

function chevron(r: number, flip: boolean): string {
  const tip = flip ? -r : r;
  const tail = flip ? r * 0.55 : -r * 0.55;
  return polygon(
    [
      [tail, -r],
      [tip, 0],
      [tail, r],
    ],
    false,
  );
}

const CACHE = new Map<string, readonly MarkerPart[]>();

/**
 * Shape per marker name from EMPHASIS_MARKERS, so emphasis never rests on colour.
 * Canvas and SVG both draw these, so the legend cannot drift from the map.
 */
export function markerParts(
  marker: string,
  radius: number,
  direction: NeighbourDirection | null = null,
): readonly MarkerPart[] {
  const key = `${marker}|${radius}|${direction ?? "-"}`;
  const cached = CACHE.get(key);
  if (cached) return cached;
  const parts = buildParts(marker, radius, direction);
  CACHE.set(key, parts);
  return parts;
}

function buildParts(
  marker: string,
  radius: number,
  direction: NeighbourDirection | null,
): MarkerPart[] {
  const r = radius;
  switch (marker) {
    case "ring":
      return [
        { d: circle(r * 0.55), mode: "fill", width: 0 },
        { d: circle(r * 1.8), mode: "stroke", width: 2 },
      ];
    case "filled-square":
      return [{ d: polygon([[-r, -r], [r, -r], [r, r], [-r, r]]), mode: "fill", width: 0 }];
    case "outline-square": {
      const s = r * 0.8;
      return [{ d: polygon([[-s, -s], [s, -s], [s, s], [-s, s]]), mode: "stroke", width: 1.5 }];
    }
    case "chevron":
      if (direction === "both") {
        return [
          {
            d: polygon([[0, -r], [r, 0], [0, r], [-r, 0]]),
            mode: "stroke",
            width: 1.5,
          },
        ];
      }
      return [{ d: chevron(r, direction === "dependent"), mode: "stroke", width: 1.75 }];
    case "plus": {
      const t = r * 0.38;
      return [
        {
          d: polygon([
            [-t, -r], [t, -r], [t, -t], [r, -t], [r, t], [t, t],
            [t, r], [-t, r], [-t, t], [-r, t], [-r, -t], [-t, -t],
          ]),
          mode: "fill",
          width: 0,
        },
      ];
    }
    case "cross":
      return [
        {
          d: `${polygon([[-r, -r], [r, r]], false)} ${polygon([[r, -r], [-r, r]], false)}`,
          mode: "stroke",
          width: 2,
        },
      ];
    case "filled-diamond":
      return [{ d: polygon([[0, -r * 1.2], [r * 1.2, 0], [0, r * 1.2], [-r * 1.2, 0]]), mode: "fill", width: 0 }];
    case "triangle-1":
      return [{ d: triangle(r), mode: "fill", width: 0 }];
    case "triangle-2":
      return [{ d: triangle(r), mode: "stroke", width: 1.75 }];
    case "triangle-3":
      return [{ d: triangle(r * 0.75), mode: "stroke", width: 1 }];
    case "dead":
      return [{ d: circle(r * 1.45), mode: "stroke", width: 1 }];
    case "outline-circle":
      return [{ d: circle(r * 0.85), mode: "stroke", width: 1.25 }];
    case "hairline":
      return [{ d: polygon([[-r, 0], [r, 0]], false), mode: "stroke", width: 1 }];
    case "group":
      return [
        { d: hexagon(r), mode: "fill", width: 0 },
        { d: hexagon(r), mode: "stroke", width: 1.5 },
      ];
    default:
      return [{ d: circle(r * 0.85), mode: "stroke", width: 1.25 }];
  }
}
