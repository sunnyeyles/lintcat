/**
 * Unified-diff hunk parsing. A finding's line counts as "in the diff"
 * only if it is an added line, numbered on the new side.
 */
import type { ChangedFile } from "@pr-review/github";

/** Matches `@@ -oldStart[,oldCount] +newStart[,newCount] @@ ...`. */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,\d+)? @@/;

type PatchLine =
  | { kind: "hunk"; oldStart: number; oldCount: number }
  | { kind: "added" | "context"; newLine: number };

// Removed lines and the no-newline marker take no new-side number, so are not yielded.
function* walkPatch(patch: string): Generator<PatchLine> {
  let newLine: number | undefined;
  for (const line of patch.split("\n")) {
    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      newLine = Number(hunk[3]);
      yield {
        kind: "hunk",
        oldStart: Number(hunk[1]),
        oldCount: Number(hunk[2] ?? "1"),
      };
      continue;
    }
    if (newLine === undefined || line.startsWith("-") || line.startsWith("\\")) {
      continue;
    }
    yield { kind: line.startsWith("+") ? "added" : "context", newLine };
    newLine += 1;
  }
}

function newSideLines(
  patch: string,
  kinds: ReadonlySet<PatchLine["kind"]>,
): Set<number> {
  const lines = new Set<number>();
  for (const line of walkPatch(patch)) {
    if (line.kind !== "hunk" && kinds.has(line.kind)) lines.add(line.newLine);
  }
  return lines;
}

const ADDED = new Set(["added"] as const);
const SHOWN = new Set(["added", "context"] as const);

/** Returns the new-side line numbers of a patch's added lines. */
export function changedLinesFromPatch(patch: string): Set<number> {
  return newSideLines(patch, ADDED);
}

/**
 * Every new-side line a patch shows, context included. GitHub accepts a
 * comment only on these, which is a wider set than the added lines alone.
 */
function diffLinesFromPatch(patch: string): Set<number> {
  return newSideLines(patch, SHOWN);
}

/** A run of lines, 1-based and inclusive. */
export interface LineRange {
  readonly startLine: number;
  readonly endLine: number;
}

/** The base-side lines each hunk header spans, context included; a pure insertion spans none. */
export function baseRangesFromPatch(patch: string): LineRange[] {
  const ranges: LineRange[] = [];
  for (const line of walkPatch(patch)) {
    if (line.kind === "hunk" && line.oldCount > 0) {
      const startLine = line.oldStart;
      ranges.push({ startLine, endLine: startLine + line.oldCount - 1 });
    }
  }
  return ranges;
}

/** Indexes changed files by filename. Files without a patch map to an empty set. */
function buildLineIndex(
  files: readonly ChangedFile[],
  linesOf: (patch: string) => Set<number>,
): Map<string, Set<number>> {
  const index = new Map<string, Set<number>>();
  for (const file of files) {
    index.set(
      file.filename,
      file.patch === undefined ? new Set() : linesOf(file.patch),
    );
  }
  return index;
}

/** Added new-side lines per file: where a finding may anchor. */
export function buildChangedLineIndex(
  files: readonly ChangedFile[],
): Map<string, Set<number>> {
  return buildLineIndex(files, changedLinesFromPatch);
}

/** Every new-side line per file the diff shows: where a comment may anchor. */
export function buildDiffLineIndex(
  files: readonly ChangedFile[],
): Map<string, Set<number>> {
  return buildLineIndex(files, diffLinesFromPatch);
}
