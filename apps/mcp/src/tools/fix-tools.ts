import { readFileSync, writeFileSync } from "node:fs";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  applyVerifiedPatches,
  exceededPatchCap,
  MAX_PATCHED_FILES,
  MAX_PATCHED_LINES,
  patchLineCount,
} from "@pr-review/reviewer";
import { findingPatchSchema, type FindingPatch } from "@pr-review/schemas";
import { z } from "zod";

import { resolveCheckoutPath } from "#src/checkout-path";
import type { ConnectedClient } from "#src/client-capabilities";
import type { McpEnvironment } from "#src/environment";
import { repositoryRoot, resolveInside } from "#src/local-git-client";
import { repoPathSchema } from "#src/tools/shared";

const patchSchema = findingPatchSchema
  .safeExtend({
    file: z
      .string()
      .min(1)
      .describe('Repository-relative path, exactly as the finding reported it, e.g. "src/auth.ts".'),
  })
  .describe(
    "Replaces lines startLine..endLine (1-based, inclusive) with `replacement`; empty deletes them. " +
      "`expected` is that range's exact current text: a mismatch means the file moved, and the call is refused.",
  );

type FixPatch = z.infer<typeof patchSchema>;

interface PlannedFile {
  path: string;
  absolute: string;
  original: string;
  content: string;
  patchCount: number;
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
  const lines = patches.reduce((total, patch) => total + patchLineCount(patch), 0);
  const exceeded = exceededPatchCap(files, lines);
  if (exceeded === "files") {
    throw new Error(
      `A fix may touch at most ${MAX_PATCHED_FILES} files; this one names ${files}. Nothing was written.`,
    );
  }
  if (exceeded === "lines") {
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

export function registerFixTools(
  server: McpServer,
  environment: McpEnvironment,
  client: ConnectedClient,
): void {
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
        repoPath: repoPathSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ patches, repoPath }) => {
      const root = await repositoryRoot(await resolveCheckoutPath(environment, client, repoPath));
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
