import { neighbourhoodOf } from "@/lib/codebase-map";
import type { NormalisedGraph } from "@/lib/codebase-map";

import type { Scene } from "@/components/codebase-map/scene";

export interface MapView {
  x: number;
  y: number;
  scale: number;
}

export interface MapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MapHandle {
  getView(): MapView;
  setView(view: MapView): void;
  fit(): void;
  /** Optional: a renderer may only ever fit the whole graph. */
  fitBounds?(bounds: MapBounds): void;
  centreOn(x: number, y: number, scale?: number): void;
}

const MIN_SCALE = 0.04;
const MAX_SCALE = 8;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function fitView(
  bounds: MapBounds,
  width: number,
  height: number,
  padding = 48,
): MapView {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const scale = clampScale(
    Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY),
  );
  return {
    scale,
    x: width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
    y: height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
  };
}

/** Grows a box around the nodes the paths land on, collapsed groups included. */
function boundsOfPaths(scene: Scene, paths: Iterable<string>): MapBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const seen = new Set<string>();
  for (const path of paths) {
    const id = scene.representativeOf.get(path);
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const node = scene.byId.get(id);
    if (!node) continue;
    minX = Math.min(minX, node.x - node.radius);
    minY = Math.min(minY, node.y - node.radius);
    maxX = Math.max(maxX, node.x + node.radius);
    maxY = Math.max(maxY, node.y + node.radius);
  }
  return seen.size === 0 ? null : { minX, minY, maxX, maxY };
}

/**
 * Where the map opens: the changed files and their one-step neighbourhood,
 * falling back to the whole scene when the change touches nothing drawn.
 */
export function initialBounds(
  scene: Scene,
  graph: NormalisedGraph,
  changedPaths: readonly string[],
  steps = 1,
): MapBounds {
  return boundsOfPaths(scene, neighbourhoodOf(graph, changedPaths, steps)) ?? scene.bounds;
}
