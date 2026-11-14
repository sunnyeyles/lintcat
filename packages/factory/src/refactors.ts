/** Advisory refactors the bugfix implementer proposes; recorded, never applied. */
import path from "node:path";

import { z } from "zod";

import type { RefactorSuggestion } from "#src/store/schema";

export const MAX_REFACTORS = 3;

export const refactorSuggestionsSchema = z.array(
  z.object({ title: z.string(), files: z.array(z.string()), rationale: z.string() }),
);

const safeFile = (file: string) => file.length > 0 && !path.isAbsolute(file) && !file.split(/[\\/]/).includes("..");

export function validateRefactors(raw: z.infer<typeof refactorSuggestionsSchema>): RefactorSuggestion[] {
  return raw
    .map((r) => ({ title: r.title.trim(), rationale: r.rationale.trim(), files: [...new Set(r.files.filter(safeFile))] }))
    .filter((r) => r.title && r.rationale && r.files.length > 0)
    .slice(0, MAX_REFACTORS);
}

export function renderRefactors(refactors: readonly RefactorSuggestion[]): string[] {
  return refactors.map((r) => `- **${r.title}** (${r.files.map((f) => `\`${f}\``).join(", ")}): ${r.rationale}`);
}

/** The objective for a follow-up `factory new` run. */
export const refactorOutcome = (r: RefactorSuggestion) => `Refactor: ${r.title}. Files: ${r.files.join(", ")}. Why: ${r.rationale}`;
