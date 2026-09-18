/**
 * Test → source edges from naming conventions alone. An edge is emitted only
 * when the source file is in the listing.
 */
import type { FileRecord, TestEdge } from "../types.js";
import { extensionOf } from "./languages.js";

/** Tried after the test's own extension, in this order. */
const SOURCE_EXTENSIONS: readonly string[] = [
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
];

const TEST_DIRECTORIES = new Set(["__tests__", "tests", "test"]);

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function joinPath(directory: string, name: string): string {
  return directory === "" ? name : `${directory}/${name}`;
}

/** The test's own directory, and its parent when that directory is a test one. */
function searchDirectories(path: string): string[] {
  const directory = directoryOf(path);
  const directories = [directory];
  if (TEST_DIRECTORIES.has(basenameOf(directory)) && directory !== "") {
    directories.push(directoryOf(directory));
  }
  return directories;
}

function candidatesFor(path: string): string[] {
  const base = basenameOf(path);
  const directories = searchDirectories(path);

  const suffixed = /^(.+)\.(?:test|spec)\.([^.]+)$/.exec(base);
  const stem = suffixed?.[1];
  const own = suffixed?.[2];
  if (stem !== undefined && own !== undefined) {
    const extensions = [own, ...SOURCE_EXTENSIONS.filter((item) => item !== own)];
    return directories.flatMap((directory) =>
      extensions.map((extension) => joinPath(directory, `${stem}.${extension}`)),
    );
  }

  const python = /^test_(.+)\.py$/.exec(base) ?? /^(.+)_test\.py$/.exec(base);
  const pythonStem = python?.[1];
  if (pythonStem !== undefined) {
    return directories.map((directory) => joinPath(directory, `${pythonStem}.py`));
  }

  const goStem = /^(.+)_test\.go$/.exec(base)?.[1];
  if (goStem !== undefined) {
    return [joinPath(directoryOf(path), `${goStem}.go`)];
  }
  return [];
}

/** A python test falls back to the one file of that name anywhere in the repo. */
function uniqueByBasename(
  paths: ReadonlyMap<string, readonly string[]>,
  candidate: string,
): string | undefined {
  const matches = paths.get(basenameOf(candidate));
  return matches?.length === 1 ? matches[0] : undefined;
}

/** Every test file mapped to the source it covers, in listing order. */
export function testEdges(files: readonly FileRecord[]): TestEdge[] {
  const known = new Set(files.map((file) => file.path));
  const byBasename = new Map<string, string[]>();
  for (const file of files) {
    const base = basenameOf(file.path);
    const bucket = byBasename.get(base);
    if (bucket === undefined) byBasename.set(base, [file.path]);
    else bucket.push(file.path);
  }

  const edges: TestEdge[] = [];
  for (const file of files) {
    if (file.role !== "test") continue;
    const candidates = candidatesFor(file.path);
    let source = candidates.find(
      (candidate) => candidate !== file.path && known.has(candidate),
    );
    if (source === undefined && extensionOf(file.path) === "py") {
      const first = candidates[0];
      source = first === undefined ? undefined : uniqueByBasename(byBasename, first);
      if (source === file.path) source = undefined;
    }
    if (source !== undefined) edges.push({ test: file.path, source });
  }
  return edges;
}
