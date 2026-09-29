/** The added and removed lines of one unified-diff patch, numbered on their own side. */

/** A changed file as the diff reports it; structurally a GitHub changed file. */
export interface PatchedFile {
  readonly filename: string;
  readonly status: string;
  readonly patch?: string | undefined;
}

interface PatchLine {
  readonly line: number;
  readonly text: string;
}

export interface PatchLines {
  /** Numbered on the new side. */
  readonly added: readonly PatchLine[];
  /** Numbered on the old side. */
  readonly removed: readonly PatchLine[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function patchLines(patch: string | undefined): PatchLines {
  const added: PatchLine[] = [];
  const removed: PatchLine[] = [];
  let oldLine: number | undefined;
  let newLine = 0;
  for (const line of (patch ?? "").split("\n")) {
    const hunk = HUNK_HEADER.exec(line);
    if (hunk !== null) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (oldLine === undefined || line.startsWith("\\")) {
      continue;
    }
    if (line.startsWith("+")) {
      added.push({ line: newLine, text: line.slice(1) });
      newLine += 1;
    } else if (line.startsWith("-")) {
      removed.push({ line: oldLine, text: line.slice(1) });
      oldLine += 1;
    } else {
      oldLine += 1;
      newLine += 1;
    }
  }
  return { added, removed };
}
