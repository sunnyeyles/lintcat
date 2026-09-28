import { CLOSED_VIEW, clusterGraph } from "@/lib/codebase-map/clustering";
import type { NormalisedGraph } from "@/lib/codebase-map/normalise";
import type { GroupImport, LayoutPoint } from "@/lib/codebase-map/types";

export type { LayoutPoint };

export interface LayoutOptions {
  /** Radius of the disc the groups sit on, and of each group's own disc. */
  mapRadius?: number;
  groupRadius?: number;
}

const DEFAULTS = { mapRadius: 1000, groupRadius: 120 } as const;

/** Wide enough that groups read as separate islands rather than one hairball. */
export const MAP_LAYOUT = { mapRadius: 3600, groupRadius: 150 } as const;

const ITERATIONS = 50;
const THETA = 1.2;
/** Sized so repulsion and gravity settle the groups on a disc of about `mapRadius`. */
const GRAVITY = 2.5;
const PULL = 4;
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

/** A group's hashed seed, which the force layout starts from. */
export function groupCentre(groupId: string, options: LayoutOptions = {}): LayoutPoint {
  const { x, y } = onDisc(groupId, options.mapRadius ?? DEFAULTS.mapRadius);
  return { x: round(x), y: round(y) };
}

/** A file on the hashed disc around its group's point. */
export function filePosition(
  path: string,
  centre: LayoutPoint,
  groupRadius: number = DEFAULTS.groupRadius,
): LayoutPoint {
  const offset = onDisc(path, groupRadius);
  return { x: round(centre.x + offset.x), y: round(centre.y + offset.y) };
}

export function seedPosition(
  path: string,
  groupId: string,
  options: LayoutOptions = {},
): LayoutPoint {
  const { mapRadius = DEFAULTS.mapRadius, groupRadius = DEFAULTS.groupRadius } = options;
  return filePosition(path, onDisc(groupId, mapRadius), groupRadius);
}

interface Body {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

/**
 * Force-directed and deterministic: seeded from the hash, a fixed number of
 * iterations, no randomness, so the same groups and counts give the same map.
 */
export function groupLayout(
  groupIds: readonly string[],
  imports: readonly GroupImport[],
  options: LayoutOptions = {},
): Record<string, LayoutPoint> {
  const mapRadius = options.mapRadius ?? DEFAULTS.mapRadius;
  const ids = [...new Set(groupIds)].sort();
  const index = new Map(ids.map((id, i) => [id, i]));
  const bodies: Body[] = ids.map((id) => ({ ...onDisc(id, mapRadius), dx: 0, dy: 0 }));
  const n = bodies.length;
  if (n === 0) return {};

  const k = mapRadius * Math.sqrt(Math.PI / n) * 0.9;
  const springs = springsOf(imports, index);

  for (let step = 0; step < ITERATIONS; step += 1) {
    const temperature = (mapRadius / 8) * (1 - step / ITERATIONS);
    for (const body of bodies) {
      body.dx = -body.x * GRAVITY;
      body.dy = -body.y * GRAVITY;
    }

    const tree = quadtree(bodies);
    for (let i = 0; i < n; i += 1) repel(bodies, i, tree, k * k);

    for (const { a, b, strength } of springs) {
      const one = bodies[a]!;
      const two = bodies[b]!;
      const x = one.x - two.x;
      const y = one.y - two.y;
      const distance = Math.hypot(x, y);
      if (distance === 0) continue;
      const force = ((distance * distance) / k) * strength;
      one.dx -= (x / distance) * force;
      one.dy -= (y / distance) * force;
      two.dx += (x / distance) * force;
      two.dy += (y / distance) * force;
    }

    for (const body of bodies) {
      const length = Math.hypot(body.dx, body.dy);
      if (length === 0) continue;
      const move = Math.min(length, temperature);
      body.x += (body.dx / length) * move;
      body.y += (body.dy / length) * move;
    }
  }

  let mx = 0;
  let my = 0;
  for (const body of bodies) {
    mx += body.x / n;
    my += body.y / n;
  }
  let extent = 0;
  for (const body of bodies) extent = Math.max(extent, Math.hypot(body.x - mx, body.y - my));
  const scale = extent > mapRadius ? mapRadius / extent : 1;

  const positions: Record<string, LayoutPoint> = {};
  ids.forEach((id, i) => {
    const body = bodies[i]!;
    positions[id] = { x: Math.round((body.x - mx) * scale), y: Math.round((body.y - my) * scale) };
  });
  return positions;
}

interface Quad {
  cx: number;
  cy: number;
  mass: number;
  size: number;
  /** Set on a leaf: the bodies it holds, compared one by one. */
  members: number[] | null;
  children: Quad[];
}

function quadtree(bodies: readonly Body[]): Quad {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const body of bodies) {
    x0 = Math.min(x0, body.x);
    y0 = Math.min(y0, body.y);
    x1 = Math.max(x1, body.x);
    y1 = Math.max(y1, body.y);
  }
  const all = bodies.map((_, i) => i);
  return build(bodies, all, x0, y0, Math.max(x1 - x0, y1 - y0, 1), 0);
}

function build(
  bodies: readonly Body[],
  members: number[],
  x0: number,
  y0: number,
  size: number,
  depth: number,
): Quad {
  let cx = 0;
  let cy = 0;
  for (const i of members) {
    cx += bodies[i]!.x;
    cy += bodies[i]!.y;
  }
  const quad: Quad = {
    cx: cx / members.length,
    cy: cy / members.length,
    mass: members.length,
    size,
    members: null,
    children: [],
  };
  if (members.length <= 1 || depth >= 24) {
    quad.members = members;
    return quad;
  }
  const half = size / 2;
  const parts: number[][] = [[], [], [], []];
  for (const i of members) {
    const body = bodies[i]!;
    parts[(body.x >= x0 + half ? 1 : 0) + (body.y >= y0 + half ? 2 : 0)]!.push(i);
  }
  parts.forEach((part, q) => {
    if (part.length === 0) return;
    quad.children.push(build(bodies, part, x0 + (q & 1 ? half : 0), y0 + (q & 2 ? half : 0), half, depth + 1));
  });
  return quad;
}

// Barnes-Hut: a far cell pushes as one mass, so repulsion stays near n log n.
function repel(bodies: Body[], i: number, quad: Quad, strength: number): void {
  const body = bodies[i]!;
  if (quad.members) {
    for (const j of quad.members) {
      if (j === i) continue;
      push(body, body.x - bodies[j]!.x, body.y - bodies[j]!.y, strength, i + j);
    }
    return;
  }
  const x = body.x - quad.cx;
  const y = body.y - quad.cy;
  const distance = Math.hypot(x, y);
  if (distance > 0 && quad.size / distance < THETA) {
    push(body, x, y, strength * quad.mass, i);
    return;
  }
  for (const child of quad.children) repel(bodies, i, child, strength);
}

function push(body: Body, x: number, y: number, strength: number, salt: number): void {
  let distance = Math.hypot(x, y);
  if (distance === 0) {
    x = Math.cos(salt);
    y = Math.sin(salt);
    distance = 1;
  }
  const force = strength / distance;
  body.dx += (x / distance) * force;
  body.dy += (y / distance) * force;
}

// Both directions fold into one spring; a heavier count pulls harder, on a log scale.
function springsOf(
  imports: readonly GroupImport[],
  index: ReadonlyMap<string, number>,
): { a: number; b: number; strength: number }[] {
  const weights = new Map<string, { a: number; b: number; count: number }>();
  for (const edge of imports) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    if (from === undefined || to === undefined || from === to || edge.count <= 0) continue;
    const a = Math.min(from, to);
    const b = Math.max(from, to);
    const key = `${a}|${b}`;
    const held = weights.get(key);
    if (held) held.count += edge.count;
    else weights.set(key, { a, b, count: edge.count });
  }
  const springs = [...weights.values()].sort((x, y) => x.a - y.a || x.b - y.b);
  const degree = new Map<number, number>();
  let heaviest = 1;
  for (const { a, b, count } of springs) {
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
    heaviest = Math.max(heaviest, Math.log2(1 + count));
  }
  // Dividing by degree keeps a hub's many springs from dragging the whole map into one knot.
  return springs.map(({ a, b, count }) => ({
    a,
    b,
    strength:
      (PULL * (0.25 + Math.log2(1 + count) / heaviest)) /
      Math.sqrt(degree.get(a)! * degree.get(b)!),
  }));
}

/** Every group the graph knows, summaries included, laid out from its group import counts. */
export function layoutGroups(
  graph: NormalisedGraph,
  options: LayoutOptions = MAP_LAYOUT,
): Record<string, LayoutPoint> {
  const clustering = clusterGraph(graph, CLOSED_VIEW);
  return groupLayout(
    clustering.groups.map((group) => group.id),
    clustering.imports,
    options,
  );
}
