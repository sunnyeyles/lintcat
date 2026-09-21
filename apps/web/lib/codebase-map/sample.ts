import type { MapFile, MapGraph, MapImport } from "@/lib/codebase-map/types";

const PACKAGES = [
  { name: "@sample/web", root: "apps/web" },
  { name: "@sample/api", root: "apps/api" },
  { name: "@sample/worker", root: "apps/worker" },
  { name: "@sample/db", root: "packages/db" },
  { name: "@sample/design", root: "packages/design" },
  { name: "@sample/schemas", root: "packages/schemas" },
  { name: "@sample/logging", root: "packages/logging" },
  { name: "@sample/github", root: "packages/github" },
] as const;

const TOP_LEVEL = ["lib", "app", "src", "components", "routes", "jobs"];
const FEATURES = ["review", "session", "queue", "github", "billing", "search", "settings"];
const NOUNS = ["session", "review", "queue", "parser", "client", "token", "diff", "index", "store"];
const ROLES = ["component", "route", "lib", "config", "test"];

const CHANGED_IN = 20;
const DEAD_IN = 33;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function packageCount(fileCount: number): number {
  return Math.max(1, Math.min(PACKAGES.length, Math.ceil(fileCount / 40)));
}

/** A repeatable fake monorepo: same seed and count, same graph, every time. */
export function sampleRepo(seed: number, fileCount: number): MapGraph {
  const count = Math.max(0, Math.floor(fileCount));
  if (count === 0) return { files: [], imports: [], truncated: false };

  const random = mulberry32(seed);
  const packages = PACKAGES.slice(0, packageCount(count));
  const files: MapFile[] = [];
  const byPackage = new Map<string, number[]>();

  for (let i = 0; i < count; i += 1) {
    const pkg = packages[Math.floor(random() * packages.length)]!;
    const depth = 1 + Math.floor(random() * 3);
    const segments: string[] = [pkg.root, TOP_LEVEL[Math.floor(random() * TOP_LEVEL.length)]!];
    for (let d = 1; d < depth; d += 1) {
      segments.push(FEATURES[Math.floor(random() * FEATURES.length)]!);
    }
    const noun = NOUNS[Math.floor(random() * NOUNS.length)]!;
    const extension = random() < 0.25 ? "tsx" : "ts";
    files.push({
      path: `${segments.join("/")}/${noun}-${i}.${extension}`,
      package: pkg.name,
      role: ROLES[Math.floor(random() * ROLES.length)]!,
      changed: (i + seed) % CHANGED_IN === 0,
      dead: false,
      inCycle: false,
    });
    const siblings = byPackage.get(pkg.name);
    if (siblings) siblings.push(i);
    else byPackage.set(pkg.name, [i]);
  }

  const seen = new Set<string>();
  const imports: MapImport[] = [];
  const add = (from: number, to: number) => {
    if (from === to) return;
    const key = `${from}\u0000${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    imports.push({ from: files[from]!.path, to: files[to]!.path });
  };

  // Every edge points at a lower index, so the only cycles are the ones closed below.
  for (let i = 1; i < count; i += 1) {
    const fanOut = Math.floor(random() * 4);
    const siblings = byPackage.get(files[i]!.package!)!;
    for (let k = 0; k < fanOut; k += 1) {
      const samePackage = random() < 0.75;
      const target = samePackage
        ? siblings[Math.floor(random() * siblings.length)]!
        : Math.floor(random() * i);
      if (target < i) add(i, target);
    }
  }

  const cycleCount = Math.max(1, Math.min(6, Math.floor(count / 150)));
  for (let c = 0; c < cycleCount && count >= 3; c += 1) {
    const start = Math.min(count - 3, 2 + Math.floor(random() * Math.max(1, count - 3)));
    const ring = [start, start + 1, start + 2];
    for (let k = 0; k < ring.length; k += 1) {
      add(ring[k]!, ring[(k + 1) % ring.length]!);
      files[ring[k]!]!.inCycle = true;
    }
  }

  const imported = new Set(imports.map((edge) => edge.to));
  for (let i = 0; i < count; i += 1) {
    const file = files[i]!;
    if (!imported.has(file.path) && !file.inCycle && (i + seed) % DEAD_IN === 0) file.dead = true;
  }

  return { files, imports, truncated: false };
}
