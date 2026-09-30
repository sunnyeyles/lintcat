/**
 * The findings a repository has marked as noise, keyed by title shape. The
 * stored file is untrusted: a bad read degrades to empty.
 */
import { errorMessage, type StructuredLogger } from "@pr-review/logging";
import {
  reviewMemorySchema,
  type ReviewMemory,
  type Suppression,
} from "@pr-review/schemas";

const MAX_SHAPE_LENGTH = 200;

/** Path-, dotted- and camelCase tokens name one call site, not a pattern. */
function isSpecific(token: string): boolean {
  return (
    token.includes("/") ||
    token.includes("_") ||
    /\w\.\w/.test(token) ||
    /[a-z][A-Z]/.test(token)
  );
}

/**
 * The pattern behind a title: identifiers and numbers dropped, so the same
 * problem in two files collapses to one shape.
 */
export function titleShape(title: string): string {
  const general = title.split(/\s+/).filter((token) => !isSpecific(token));
  const shape = general
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SHAPE_LENGTH)
    .trim();
  return shape === "" ? "untitled" : shape;
}

/** The storage seam: one file, read and written by the caller's transport. */
export interface MemoryStore {
  read(): Promise<string | undefined>;
  write(content: string): Promise<void>;
}

export const MEMORY_FILE_PATH = "memory.json";

export function emptyMemory(): ReviewMemory {
  return { version: 1, suppressions: [] };
}

export async function readMemory(
  store: MemoryStore,
  logger: StructuredLogger,
): Promise<ReviewMemory> {
  let raw: string | undefined;
  try {
    raw = await store.read();
  } catch (error) {
    logger.error("memory.invalid", { reason: errorMessage(error) });
    return emptyMemory();
  }
  if (raw === undefined) {
    return emptyMemory();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    logger.error("memory.invalid", { reason: errorMessage(error) });
    return emptyMemory();
  }

  const validated = reviewMemorySchema.safeParse(parsed);
  if (!validated.success) {
    logger.error("memory.invalid", {
      reason: validated.error.issues[0]?.message ?? "does not match the schema",
    });
    return emptyMemory();
  }
  return validated.data;
}

export async function writeMemory(
  store: MemoryStore,
  memory: ReviewMemory,
): Promise<void> {
  await store.write(`${JSON.stringify(memory, null, 2)}\n`);
}

/** What a suppression is matched against: one finding, or one recorded title. */
export interface SuppressibleFinding {
  category: string;
  title: string;
}

/** Keyed by shape, and never expired: a human, not a count, recorded it. */
export function addSuppression(
  memory: ReviewMemory,
  finding: SuppressibleFinding & { reason?: string | undefined },
  now: Date,
): ReviewMemory {
  const shape = titleShape(finding.title);
  const suppression: Suppression = {
    category: finding.category,
    shape,
    title: finding.title,
    ...(finding.reason === undefined ? {} : { reason: finding.reason }),
    createdAt: now.toISOString(),
  };
  const others = memory.suppressions.filter(
    (existing) => existing.shape !== shape,
  );
  return { ...memory, suppressions: [...others, suppression] };
}

export function isSuppressed(
  memory: ReviewMemory,
  finding: SuppressibleFinding,
): boolean {
  const shape = titleShape(finding.title);
  return memory.suppressions.some((suppression) => suppression.shape === shape);
}

/** Splits findings into the ones that survive the memory and the ones it hides. */
export function partitionSuppressed<T extends SuppressibleFinding>(
  memory: ReviewMemory,
  findings: readonly T[],
): { kept: T[]; suppressed: T[] } {
  const kept: T[] = [];
  const suppressed: T[] = [];
  for (const finding of findings) {
    (isSuppressed(memory, finding) ? suppressed : kept).push(finding);
  }
  return { kept, suppressed };
}
