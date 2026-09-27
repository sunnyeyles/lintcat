import type { ReviewRecordChangedFile } from "@pr-review/schemas";

import { baseName, directoryOf } from "@/lib/codebase-map/clustering";
import type { FindingHeat } from "@/lib/codebase-map/from-snapshot";
import type { MapFile, MapGraph } from "@/lib/codebase-map/types";

export interface DiagramBox {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiagramNode {
  id: string;
  label: string;
  x: number;
  y: number;
  changed?: boolean;
  pulse?: boolean;
  findings?: number;
}

export interface DiagramEdge {
  from: string;
  to: string;
  hot: boolean;
}

export interface ChangeDiagram {
  width: number;
  height: number;
  boxes: DiagramBox[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  changedCount: number;
  hiddenChanged: number;
  neighbourCount: number;
}

export interface ChangeDiagramInput {
  graph: MapGraph | undefined;
  changedFiles: readonly ReviewRecordChangedFile[];
  heat: FindingHeat;
}

export interface ChangeDiagramOptions {
  maxNodes?: number;
  maxChanged?: number;
}

const COLUMNS = 3;
const MARGIN = 16;
const TOP = 24;
const GAP = 24;
const BOX_W = 208;
const COLUMN_STEP = BOX_W + 32;
const HEADER = 28;
const CELL_W = BOX_W / 2;
const ROW_H = 56;
const LABEL_MAX = 14;
const BOX_LABEL_MAX = 32;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function byPath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function topDirectory(path: string): string {
  const directory = directoryOf(path);
  return directory === "." ? "." : directory.split("/").slice(0, 2).join("/");
}

function boxKey(file: MapFile): string {
  return file.package ?? topDirectory(file.path);
}

function findingsAt(heat: FindingHeat, path: string): number {
  return heat[path]?.total ?? 0;
}

function byFindings(heat: FindingHeat) {
  return (a: string, b: string) => findingsAt(heat, b) - findingsAt(heat, a) || byPath(a, b);
}

interface Selection {
  files: MapFile[];
  edges: DiagramEdge[];
  changedCount: number;
}

function select(
  { graph, changedFiles, heat }: ChangeDiagramInput,
  maxNodes: number,
  maxChanged: number,
): Selection {
  if (!graph) {
    const paths = changedFiles
      .filter((file) => file.status !== "removed")
      .map((file) => file.path)
      .sort(byFindings(heat));
    return {
      files: paths.slice(0, maxNodes).map((path) => ({ path, changed: true })),
      edges: [],
      changedCount: paths.length,
    };
  }

  const byFile = new Map(graph.files.map((file) => [file.path, file]));
  const changed = graph.files
    .filter((file) => file.changed === true)
    .map((file) => file.path)
    .sort(byFindings(heat));
  const picked = new Set(changed.slice(0, Math.min(maxChanged, maxNodes)));

  // A neighbour's score is how many distinct drawn changed files it touches.
  const links = new Map<string, Set<string>>();
  const link = (neighbour: string, changedPath: string) => {
    if (picked.has(neighbour) || byFile.get(neighbour)?.changed === true) return;
    if (!byFile.has(neighbour)) return;
    const seen = links.get(neighbour) ?? new Set<string>();
    seen.add(changedPath);
    links.set(neighbour, seen);
  };
  for (const { from, to } of graph.imports) {
    if (picked.has(from)) link(to, from);
    if (picked.has(to)) link(from, to);
  }
  const neighbours = [...links.entries()]
    .sort(([a, as], [b, bs]) => bs.size - as.size || byPath(a, b))
    .slice(0, maxNodes - picked.size)
    .map(([path]) => path);

  const drawn = new Set([...picked, ...neighbours]);
  const edges: DiagramEdge[] = [];
  const seen = new Set<string>();
  for (const { from, to } of graph.imports) {
    if (from === to || !drawn.has(from) || !drawn.has(to)) continue;
    const key = from < to ? `${from}\u0000${to}` : `${to}\u0000${from}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from, to, hot: picked.has(from) || picked.has(to) });
  }

  return {
    files: [...drawn].map((path) => byFile.get(path) ?? { path }),
    edges,
    changedCount: changed.length,
  };
}

export function changeDiagram(
  input: ChangeDiagramInput,
  { maxNodes = 16, maxChanged = 10 }: ChangeDiagramOptions = {},
): ChangeDiagram {
  const { files, edges, changedCount } = select(input, maxNodes, maxChanged);

  const groups = new Map<string, MapFile[]>();
  for (const file of files) {
    const key = boxKey(file);
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }
  const changedIn = (members: MapFile[]) => members.filter((file) => file.changed).length;
  const ordered = [...groups.entries()].sort(
    ([a, am], [b, bm]) => changedIn(bm) - changedIn(am) || byPath(a, b),
  );

  const columns = Math.max(1, Math.min(COLUMNS, ordered.length));
  const heights = Array.from({ length: columns }, () => TOP);
  const boxes: DiagramBox[] = [];
  const nodes: DiagramNode[] = [];

  for (const [key, members] of ordered) {
    members.sort((a, b) => Number(b.changed === true) - Number(a.changed === true) || byPath(a.path, b.path));
    const rows = Math.ceil(members.length / 2);
    const h = HEADER + rows * ROW_H + 4;
    const column = heights.indexOf(Math.min(...heights));
    const x = MARGIN + column * COLUMN_STEP;
    const y = heights[column]!;
    heights[column] = y + h + GAP;
    boxes.push({ label: clip(key, BOX_LABEL_MAX), x, y, w: BOX_W, h });

    members.forEach((file, i) => {
      const row = Math.floor(i / 2);
      const col = i % 2;
      const alone = col === 0 && i === members.length - 1;
      const findings = findingsAt(input.heat, file.path);
      // Stagger odd rows and lift the right column so the grid doesn't read as a table.
      nodes.push({
        id: file.path,
        label: clip(baseName(file.path), LABEL_MAX),
        x: x + CELL_W / 2 + col * CELL_W + (alone ? CELL_W / 2 : 0) + (row % 2 === 1 ? 8 : -4),
        y: y + HEADER + 16 + row * ROW_H - (col === 1 ? 8 : 0),
        changed: file.changed === true,
        pulse: file.changed === true && findings > 0,
        findings,
      });
    });
  }

  return {
    width: MARGIN + (columns - 1) * COLUMN_STEP + BOX_W + MARGIN,
    height: Math.max(...heights),
    boxes,
    nodes,
    edges,
    changedCount,
    hiddenChanged: changedCount - nodes.filter((node) => node.changed).length,
    neighbourCount: nodes.filter((node) => !node.changed).length,
  };
}
