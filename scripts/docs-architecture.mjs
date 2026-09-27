// Writes the workspace's package graph into docs/index.html, where architecture.js draws it.
// `--check` exits 1 instead of writing when the page is stale.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PAGE = join(ROOT, "docs/index.html");

const SCOPE = "@pr-review/";
// Every package imports it, so on the map it would only be noise.
const TOOLING = new Set(["@pr-review/eslint-config"]);
const OPEN = '<script type="application/json" id="architecture">';
const CLOSE = "</script>";

function workspaceDirs(root) {
  const lines = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8").split("\n");
  const globs = [];
  for (const line of lines.slice(lines.findIndex((l) => /^packages:\s*$/.test(l)) + 1)) {
    const item = line.match(/^\s+-\s*["']?([^"'#\s]+)/);
    if (item) globs.push(item[1]);
    else if (/^\S/.test(line)) break;
  }
  return globs
    .flatMap((glob) => {
      if (!glob.endsWith("/*")) return [glob];
      const parent = glob.slice(0, -2);
      if (!existsSync(join(root, parent))) return [];
      return readdirSync(join(root, parent), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${parent}/${entry.name}`);
    })
    .filter((dir) => existsSync(join(root, dir, "package.json")))
    .sort();
}

export function buildArchitecture(root = ROOT) {
  const manifests = workspaceDirs(root)
    .map((dir) => ({ dir, pkg: JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) }))
    .filter(({ pkg }) => pkg.name?.startsWith(SCOPE) && !TOOLING.has(pkg.name));
  const idOf = (name) => name.slice(SCOPE.length);
  const ids = new Set(manifests.map(({ pkg }) => idOf(pkg.name)));

  const drafts = manifests.map(({ dir, pkg }) => {
    if (!pkg.description) {
      throw new Error(`${dir}/package.json needs a "description": it labels the architecture map.`);
    }
    const imports = Object.keys(pkg.dependencies ?? {})
      .filter((dep) => dep.startsWith(SCOPE) && ids.has(idOf(dep)))
      .map(idOf)
      .sort();
    return { id: idOf(pkg.name), dir, pkg, imports };
  });
  const byId = new Map(drafts.map((d) => [d.id, d]));

  const layers = new Map();
  const layerOf = (id, trail = []) => {
    if (trail.includes(id)) throw new Error(`Import cycle: ${[...trail, id].join(" -> ")}`);
    if (!layers.has(id)) {
      const below = byId.get(id).imports.map((dep) => layerOf(dep, [...trail, id]));
      layers.set(id, below.length ? Math.max(...below) + 1 : 0);
    }
    return layers.get(id);
  };

  const nodes = drafts.map(({ id, dir, pkg, imports }) => ({
    id,
    name: pkg.name,
    path: dir,
    kind: dir.startsWith("packages/") ? "package" : "entry",
    layer: layerOf(id),
    description: pkg.description,
    imports,
    importedBy: drafts.filter((d) => d.imports.includes(id)).map((d) => d.id),
  }));
  return { source: "package.json of every pnpm workspace package", nodes };
}

function serializeArchitecture({ source, nodes }) {
  const rows = nodes.map((node) => `    ${JSON.stringify(node)}`).join(",\n");
  return `{\n  "source": ${JSON.stringify(source)},\n  "nodes": [\n${rows}\n  ]\n}`.replace(/</g, "\\u003c");
}

function blockBounds(page) {
  const start = page.indexOf(OPEN);
  if (start < 0) throw new Error(`${PAGE} has no ${OPEN} block`);
  const from = start + OPEN.length;
  return { from, to: page.indexOf(CLOSE, from) };
}

export function readArchitecture(page) {
  const { from, to } = blockBounds(page);
  return JSON.parse(page.slice(from, to));
}

function withArchitecture(page, architecture) {
  const { from, to } = blockBounds(page);
  return `${page.slice(0, from)}\n${serializeArchitecture(architecture)}\n${page.slice(to)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const page = readFileSync(PAGE, "utf8");
  const next = withArchitecture(page, buildArchitecture());
  if (next === page) process.exit(0);
  if (process.argv.includes("--check")) {
    console.error("docs/index.html is stale: run `pnpm docs:map`.");
    process.exit(1);
  }
  writeFileSync(PAGE, next);
  console.log("docs/index.html: architecture map updated.");
}
