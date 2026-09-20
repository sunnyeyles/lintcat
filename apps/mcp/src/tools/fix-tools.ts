import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  applyVerifiedPatches,
  MAX_PATCHED_FILES,
  MAX_PATCHED_LINES,
} from "@pr-review/reviewer";
import type { FindingPatch } from "@pr-review/schemas";
import { z } from "zod";

import type { McpEnvironment } from "#src/environment";
import { repositoryRoot, resolveInside } from "#src/local-git-client";

const patchSchema = z
  .object({
    file: z
      .string()
      .min(1)
      .describe('Repository-relative path, exactly as the finding reported it, e.g. "src/auth.ts".'),
    startLine: z.number().int().positive().describe("First line the patch replaces, 1-based."),
    endLine: z.number().int().positive().describe("Last line the patch replaces, inclusive."),
    expected: z
      .string()
      .min(1)
      .describe("That range's exact current text. A mismatch means the file moved, and the call is refused."),
    replacement: z.string().describe("The text to put in its place; empty deletes the range."),
  })
  .refine((patch) => patch.endLine >= patch.startLine, {
    message: "endLine must not precede startLine",
  });

type FixPatch = z.infer<typeof patchSchema>;

interface PlannedFile {
  path: string;
  absolute: string;
  original: string;
  content: string;
  patchCount: number;
}

function lineCount(patch: FixPatch): number {
  return patch.endLine - patch.startLine + 1;
}

function byFile(patches: readonly FixPatch[]): Map<string, FixPatch[]> {
  const grouped = new Map<string, FixPatch[]>();
  for (const patch of patches) {
    const existing = grouped.get(patch.file);
    if (existing === undefined) {
      grouped.set(patch.file, [patch]);
    } else {
      existing.push(patch);
    }
  }
  return grouped;
}

function assertWithinCaps(patches: readonly FixPatch[], files: number): void {
  if (files > MAX_PATCHED_FILES) {
    throw new Error(
      `A fix may touch at most ${MAX_PATCHED_FILES} files; this one names ${files}. Nothing was written.`,
    );
  }
  const lines = patches.reduce((total, patch) => total + lineCount(patch), 0);
  if (lines > MAX_PATCHED_LINES) {
    throw new Error(
      `A fix may replace at most ${MAX_PATCHED_LINES} lines; this one replaces ${lines}. Nothing was written.`,
    );
  }
}

function where(patch: FindingPatch, file: string): string {
  return `${file}:${patch.startLine}-${patch.endLine}`;
}

/** Every file's new contents, or a throw; nothing is written until all of them hold. */
function planFiles(root: string, grouped: ReadonlyMap<string, FixPatch[]>): PlannedFile[] {
  const planned: PlannedFile[] = [];
  for (const [file, filePatches] of grouped) {
    const absolute = resolveInside(root, file);
    const original = readFileSync(absolute, "utf8");
    const applied = applyVerifiedPatches(original, filePatches);
    if (applied.status === "stale") {
      throw new Error(
        `${where(applied.patch, file)} no longer holds the text the review proved the patch against, ` +
          "so the file changed since then. Nothing was written; review again to get a fresh patch.",
      );
    }
    if (applied.status === "overlapping") {
      throw new Error(
        `${where(applied.patch, file)} overlaps another patch for the same file. Nothing was written.`,
      );
    }
    planned.push({
      path: file,
      absolute,
      original,
      content: applied.content,
      patchCount: filePatches.length,
    });
  }
  return planned;
}

/** Puts back what was already written, so a half-applied fix never survives. */
function restore(written: readonly PlannedFile[]): void {
  for (const file of written) {
    try {
      writeFileSync(file.absolute, file.original);
    } catch {
      // The throw that triggered the rollback is the one worth reporting.
    }
  }
}

function writeAll(planned: readonly PlannedFile[]): void {
  const written: PlannedFile[] = [];
  for (const file of planned) {
    try {
      writeFileSync(file.absolute, file.content);
    } catch (error) {
      restore(written);
      throw new Error(
        `Writing ${file.path} failed, so the working tree was put back as it was: ${(error as Error).message}`,
      );
    }
    written.push(file);
  }
}

export function registerFixTools(server: McpServer, environment: McpEnvironment): void {
  server.registerTool(
    "apply_fix",
    {
      title: "Apply a verified fix",
      description:
        "Write patches the reviewer already verified into a local checkout's working tree, so the change " +
        "shows up in git diff and the usual tooling. Each patch is proved against the file again before " +
        "anything is written: if the range no longer holds its `expected` text the file has moved since the " +
        "review, and the whole call is refused. All-or-nothing — a failed write puts the working tree back. " +
        `At most ${MAX_PATCHED_FILES} files and ${MAX_PATCHED_LINES} replaced lines per call. Never stages, ` +
        "commits or pushes; what to do with the change is yours to decide.",
      inputSchema: {
        patches: z
          .array(patchSchema)
          .min(1)
          .describe("The `patch` of one or more findings a review returned, each with its finding's `file`."),
        repoPath: z
          .string()
          .optional()
          .describe("Path to the git checkout; defaults to the server's working directory."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ patches, repoPath }) => {
      const root = await repositoryRoot(path.resolve(environment.cwd, repoPath ?? "."));
      const grouped = byFile(patches);
      assertWithinCaps(patches, grouped.size);
      const planned = planFiles(root, grouped);
      writeAll(planned);

      const files = planned.map((file) => ({ path: file.path, patches: file.patchCount }));
      environment.logger.info("mcp.fix.applied", { root, patchCount: patches.length, files });
      return {
        content: [
          {
            type: "text",
            text:
              `Applied ${patches.length} verified patch(es) to ${planned.length} file(s) in the working tree ` +
              `of ${root}. No commit was made and nothing was pushed.`,
          },
          { type: "text", text: JSON.stringify({ root, files }, null, 2) },
        ],
      };
    },
  );
}
