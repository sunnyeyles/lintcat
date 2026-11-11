/** Repository intelligence for feature and refactor runs: the import graph, not whole files, in the prompt. */
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { buildRepositoryIndex, classifyFileRole, computeImpact, findReferences, type RepositoryIndex } from "@pr-review/index";

import type { LocateResult } from "#src/locate";

const run = promisify(execFile);

const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_CANDIDATES = 8;
const TEST_DATA_DIRECTORIES = new Set(["fixtures", "__fixtures__", "testdata", "__snapshots__", "snapshots"]);

/** Tests and the data beside them, by path convention only. */
export function isTestPath(file: string): boolean {
  if (classifyFileRole(file) === "test") return true;
  return file.split("/").slice(0, -1).some((segment) => TEST_DATA_DIRECTORIES.has(segment));
}

const cache = new Map<string, Promise<RepositoryIndex>>();

async function readTrackedFiles(root: string): Promise<{ files: Map<string, string>; truncated: boolean }> {
  const { stdout } = await run("git", ["-C", root, "ls-files", "-z"], { maxBuffer: 64 * 1024 * 1024 });
  const files = new Map<string, string>();
  let total = 0;
  let truncated = false;
  for (const file of stdout.split("\0").filter(Boolean)) {
    const absolute = path.join(root, file);
    const info = await stat(absolute).catch(() => null);
    if (!info?.isFile() || info.size > MAX_FILE_BYTES) continue;
    if (total + info.size > MAX_TOTAL_BYTES) {
      truncated = true;
      break;
    }
    const contents = await readFile(absolute, "utf8");
    if (contents.includes("\0")) continue;
    total += info.size;
    files.set(file, contents);
  }
  return { files, truncated };
}

/** Indexes the checkout's tracked files, once per HEAD sha. */
export async function indexAtHead(root: string): Promise<RepositoryIndex> {
  const sha = (await run("git", ["-C", root, "rev-parse", "HEAD"])).stdout.trim();
  const key = `${path.resolve(root)}@${sha}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = readTrackedFiles(root).then(({ files, truncated }) => buildRepositoryIndex({ sha, files, truncated }));
    cache.set(key, hit);
    hit.catch(() => cache.delete(key));
    while (cache.size > 4) cache.delete(cache.keys().next().value!);
  }
  return hit;
}

export interface ArchitectureBrief {
  sha: string;
  truncated: boolean;
  /** Existing modules the spec's terms point at, most relevant first. */
  candidates: { path: string; package: string | null; importers: number; test: string | null; hits: number }[];
  impact: { direct: string[]; transitiveCount: number; packages: string[]; entryPoints: string[]; partial: boolean };
  placement: string;
  tests: string[];
  risks: string[];
}

/** Ranks located files by the graph and turns them into a compact placement and impact brief. */
export async function analyseRepository(worktree: string, located: LocateResult): Promise<ArchitectureBrief> {
  const index = await indexAtHead(worktree);
  const candidates = located.files
    .map(({ path: file, hits }) => ({ file: index.files.get(file), hits }))
    .filter((c): c is { file: NonNullable<typeof c.file>; hits: number } => c.file?.role === "source")
    .sort((a, b) => b.hits - a.hits || b.file.importerCount - a.file.importerCount)
    .slice(0, MAX_CANDIDATES)
    .map(({ file, hits }) => ({
      path: file.path,
      package: file.package ?? null,
      importers: file.importerCount,
      test: file.coveredBy ?? null,
      hits,
    }));

  const impact = computeImpact(
    index,
    candidates.map((c) => ({ path: c.path, status: "modified" as const })),
  );
  const top = candidates[0];
  const directories = new Map<string, number>();
  for (const c of candidates) directories.set(path.posix.dirname(c.path), (directories.get(path.posix.dirname(c.path)) ?? 0) + 1);
  const home = [...directories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const placement = top
    ? `Extend ${top.path}${top.package ? ` (package ${top.package})` : ""}; related code sits in ${home === "." ? "the repository root" : `${home}/`}. Add a new module there only if no candidate owns the behaviour.`
    : "No existing module matches the spec's terms; place new code beside the closest feature and say why.";

  const tests = candidates.map((c) =>
    c.test ? `${c.path}: extend ${c.test}` : `${c.path}: no paired test, add one beside it`,
  );
  if (impact.counts.direct > 0) tests.push(`${impact.counts.direct} direct importer(s) may need their tests rerun`);

  const risks: string[] = [];
  if (impact.packages.length > 1) risks.push(`crosses ${impact.packages.length} packages: ${impact.packages.join(", ")}`);
  for (const hub of impact.hubs) {
    const refs = findReferences(index, { path: hub.path });
    risks.push(`${hub.path} has ${hub.dependents} dependents${refs.known ? ` (${refs.total} importing files)` : ""}; keep its public interface stable`);
  }
  if (impact.counts.inCycle > 0) risks.push(`import cycle through ${impact.inCycle.join(", ")}`);
  if (index.truncated) risks.push("index truncated: the repository exceeds the size cap");

  return {
    sha: index.sha,
    truncated: index.truncated,
    candidates,
    impact: {
      direct: impact.direct.slice(0, 15),
      transitiveCount: impact.counts.transitive,
      packages: [...impact.packages],
      entryPoints: impact.entryPoints.slice(0, 10),
      partial: impact.partial,
    },
    placement,
    tests,
    risks,
  };
}

export function renderArchitecture(brief: ArchitectureBrief): string {
  const list = (items: readonly string[]) => (items.length ? items.map((i) => `- ${i}`) : ["- none"]);
  return [
    `# Architecture brief at \`${brief.sha.slice(0, 12)}\``,
    "",
    "## Candidate modules to reuse",
    ...list(
      brief.candidates.map(
        (c) => `\`${c.path}\`${c.package ? ` (${c.package})` : ""}: ${c.importers} importer(s), ${c.hits} term hit(s)${c.test ? `, tested by \`${c.test}\`` : ""}`,
      ),
    ),
    "",
    "## File-level impact of changing them",
    ...list([
      ...brief.impact.direct.map((p) => `direct importer \`${p}\``),
      `${brief.impact.transitiveCount} transitive dependent(s)`,
      ...(brief.impact.packages.length ? [`packages: ${brief.impact.packages.join(", ")}`] : []),
      ...brief.impact.entryPoints.map((p) => `entry point \`${p}\``),
      ...(brief.impact.partial ? ["partial: some languages or files are outside the graph"] : []),
    ]),
    "",
    "## Recommended placement",
    brief.placement,
    "",
    "## Test implications",
    ...list(brief.tests),
    "",
    "## Risks",
    ...list(brief.risks),
    "",
  ].join("\n");
}
