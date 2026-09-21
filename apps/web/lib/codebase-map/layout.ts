import { groupIdFor } from "@/lib/codebase-map/clustering";
import type { NormalisedGraph } from "@/lib/codebase-map/normalise";
import type { MapFile } from "@/lib/codebase-map/types";

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutOptions {
  /** Radius of the disc the groups sit on, and of each group's own disc. */
  mapRadius?: number;
  groupRadius?: number;
}

const DEFAULTS = { mapRadius: 1000, groupRadius: 120 } as const;
const TAU = Math.PI * 2;

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

function unit(text: string): number {
  return hash(text) / 0x1_0000_0000;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// Square-rooting the radius spreads points evenly over the disc instead of crowding the centre.
function onDisc(key: string, radius: number): LayoutPoint {
  const angle = unit(`${key}#angle`) * TAU;
  const distance = radius * Math.sqrt(unit(`${key}#radius`));
  return { x: distance * Math.cos(angle), y: distance * Math.sin(angle) };
}

export function seedPosition(
  path: string,
  groupId: string,
  options: LayoutOptions = {},
): LayoutPoint {
  const { mapRadius = DEFAULTS.mapRadius, groupRadius = DEFAULTS.groupRadius } = options;
  const centre = onDisc(groupId, mapRadius);
  const offset = onDisc(path, groupRadius);
  return { x: round(centre.x + offset.x), y: round(centre.y + offset.y) };
}

export function seedPositionFor(file: MapFile, options: LayoutOptions = {}): LayoutPoint {
  return seedPosition(file.path, groupIdFor(file), options);
}

export function seedLayout(
  graph: NormalisedGraph,
  options: LayoutOptions = {},
): ReadonlyMap<string, LayoutPoint> {
  const positions = new Map<string, LayoutPoint>();
  for (const file of graph.files) {
    positions.set(file.path, seedPositionFor(file, options));
  }
  return positions;
}
