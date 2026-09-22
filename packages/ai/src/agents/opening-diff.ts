/**
 * The diff the opening message carries: each changed file's patch, minus the
 * files no reviewer reads (lockfiles, build output, binaries), under a budget.
 */
import type { ChangedFile } from "@pr-review/github";
import { classifyFileRole } from "@pr-review/index";

export type OmissionReason = "vendored" | "generated" | "binary" | "over budget";

export interface OmittedFile {
  filename: string;
  reason: OmissionReason;
}

export interface OpeningDiff {
  diff: string;
  omitted: OmittedFile[];
}

export interface OpeningDiffLimits {
  /** The whole diff's budget, in characters. */
  maxChars: number;
  /** One file's patch is cut past this many characters. */
  maxFileChars: number;
}

export const DEFAULT_OPENING_DIFF_LIMITS: OpeningDiffLimits = {
  maxChars: 80_000,
  maxFileChars: 20_000,
};

/** Omitted files named in the opening message before "and N more". */
const MAX_NAMED_OMISSIONS = 30;

const FILE_CUT_MARKER = "\n[... patch truncated; get_diff with this path returns it whole]";

function skipReason(file: ChangedFile): OmissionReason | undefined {
  if (file.patch === undefined) {
    return "binary";
  }
  const role = classifyFileRole(file.filename);
  return role === "vendored" || role === "generated" ? role : undefined;
}

/** Cuts on a line boundary so no hunk line is left half-rendered. */
function capPatch(patch: string, maxChars: number): string {
  if (patch.length <= maxChars) {
    return patch;
  }
  const cut = patch.lastIndexOf("\n", maxChars);
  return patch.slice(0, cut > 0 ? cut : maxChars) + FILE_CUT_MARKER;
}

// The same header lines a unified diff carries, so the shape is familiar.
function renderPatch(file: ChangedFile, patch: string): string {
  return [
    `diff --git a/${file.filename} b/${file.filename}`,
    `--- a/${file.filename}`,
    `+++ b/${file.filename}`,
    patch,
  ].join("\n");
}

/** Renders the reviewable patches in order until the budget runs out. */
export function buildOpeningDiff(
  changedFiles: readonly ChangedFile[],
  limits: OpeningDiffLimits = DEFAULT_OPENING_DIFF_LIMITS,
): OpeningDiff {
  const rendered: string[] = [];
  const omitted: OmittedFile[] = [];
  let used = 0;
  let exhausted = false;

  for (const file of changedFiles) {
    const reason = skipReason(file);
    if (reason !== undefined) {
      omitted.push({ filename: file.filename, reason });
      continue;
    }
    if (exhausted) {
      omitted.push({ filename: file.filename, reason: "over budget" });
      continue;
    }
    const entry = renderPatch(file, capPatch(file.patch ?? "", limits.maxFileChars));
    if (used + entry.length > limits.maxChars) {
      exhausted = true;
      omitted.push({ filename: file.filename, reason: "over budget" });
      continue;
    }
    rendered.push(entry);
    used += entry.length + 1;
  }

  return { diff: rendered.join("\n"), omitted };
}

/** One line naming what the diff left out, or nothing when it left out nothing. */
export function renderOmitted(omitted: readonly OmittedFile[]): string[] {
  if (omitted.length === 0) {
    return [];
  }
  const named = omitted
    .slice(0, MAX_NAMED_OMISSIONS)
    .map((entry) => `${entry.filename} (${entry.reason})`);
  const more = omitted.length - MAX_NAMED_OMISSIONS;
  return [
    `Omitted from the diff below (a patch is still available through get_diff with the path, a file through get_file): ${named.join(", ")}${more > 0 ? `, and ${more} more` : ""}`,
    "",
  ];
}
