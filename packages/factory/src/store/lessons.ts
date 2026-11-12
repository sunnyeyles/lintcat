/** Learning memory: proposed lessons, deduplicated by key. The report is the only writer. */
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";

import type { FactoryDatabase } from "#src/store/client";
import { factoryLessons, type FactoryLesson, type LessonTarget } from "#src/store/schema";

export interface LessonInput {
  key: string;
  scope: string;
  target: LessonTarget;
  title: string;
  rootCause: string;
  proposal: string;
  confidence: number;
  evidenceRunIds: string[];
  occurrences: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

const later = (a: Date, b: Date) => (a > b ? a : b);
const earlier = (a: Date, b: Date) => (a < b ? a : b);

// Evidence is a union so pruned history never shrinks it; only an expired lesson that recurs revives.
export async function upsertLessons(database: FactoryDatabase, lessons: readonly LessonInput[]): Promise<FactoryLesson[]> {
  if (lessons.length === 0) return [];
  const existing = await database
    .select()
    .from(factoryLessons)
    .where(inArray(factoryLessons.key, lessons.map((l) => l.key)));
  const byKey = new Map(existing.map((row) => [row.key, row]));
  const saved: FactoryLesson[] = [];
  for (const lesson of lessons) {
    const prior = byKey.get(lesson.key);
    const evidence = [...new Set([...(prior?.evidenceRunIds ?? []), ...lesson.evidenceRunIds])].sort();
    const revived = prior?.retiredReason === "expired" && lesson.lastSeenAt > prior.expiresAt;
    const row = {
      ...lesson,
      ...(revived ? { status: "proposed" as const, retiredReason: null } : {}),
      evidenceRunIds: evidence,
      occurrences: Math.max(prior?.occurrences ?? 0, lesson.occurrences),
      firstSeenAt: prior ? earlier(prior.firstSeenAt, lesson.firstSeenAt) : lesson.firstSeenAt,
      lastSeenAt: prior ? later(prior.lastSeenAt, lesson.lastSeenAt) : lesson.lastSeenAt,
      expiresAt: prior ? later(prior.expiresAt, lesson.expiresAt) : lesson.expiresAt,
    };
    const { key: _key, ...update } = row;
    const [stored] = await database
      .insert(factoryLessons)
      .values(row)
      .onConflictDoUpdate({ target: factoryLessons.key, set: { ...update, updatedAt: sql`now()` } })
      .returning();
    saved.push(stored!);
  }
  return saved;
}

export async function expireLessons(database: FactoryDatabase, now: Date): Promise<number> {
  const rows = await database
    .update(factoryLessons)
    .set({ status: "retired", retiredReason: "expired", updatedAt: sql`now()` })
    .where(and(eq(factoryLessons.status, "proposed"), lt(factoryLessons.expiresAt, now)))
    .returning({ key: factoryLessons.key });
  return rows.length;
}

export function listLessons(
  database: FactoryDatabase,
  { status }: { status?: FactoryLesson["status"] } = {},
): Promise<FactoryLesson[]> {
  return database
    .select()
    .from(factoryLessons)
    .where(status === undefined ? undefined : eq(factoryLessons.status, status))
    .orderBy(desc(factoryLessons.confidence), asc(factoryLessons.key));
}
