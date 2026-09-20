import type { Database } from "@pr-review/db";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";

/** Every GitHub-to-Postgres sync path fans out at this width. */
export const LOOKUP_CONCURRENCY = 8;

export interface ReconcilePlan<Candidate, Resolved> {
  database: Database;
  logger: StructuredLogger;
  /** Logged at error level, with `reason: "github_lookup_failed"`, when a lookup throws. */
  skippedEvent: string;
  candidates: readonly Candidate[];
  /** Log fields identifying one candidate. */
  fields(candidate: Candidate): Record<string, unknown>;
  /** `undefined` writes nothing for this candidate; throwing keeps its stored state. */
  lookup(candidate: Candidate): Promise<Resolved | undefined>;
  /** Sort key; writes run in ascending order. */
  order(resolved: Resolved): number;
  apply(database: Database, resolved: Resolved): Promise<void>;
}

/**
 * Looks every candidate up at bounded concurrency, then applies what resolved in
 * `order` inside one transaction that opens only once every lookup has settled.
 */
export async function reconcile<Candidate, Resolved>(
  plan: ReconcilePlan<Candidate, Resolved>,
): Promise<void> {
  const resolved: Resolved[] = [];
  const lookup = async (candidate: Candidate) => {
    try {
      const result = await plan.lookup(candidate);
      if (result !== undefined) resolved.push(result);
    } catch (error) {
      plan.logger.error(plan.skippedEvent, {
        ...plan.fields(candidate),
        reason: "github_lookup_failed",
        error: errorMessage(error),
      });
    }
  };
  for (let start = 0; start < plan.candidates.length; start += LOOKUP_CONCURRENCY) {
    await Promise.all(plan.candidates.slice(start, start + LOOKUP_CONCURRENCY).map(lookup));
  }

  resolved.sort((a, b) => plan.order(a) - plan.order(b));
  await plan.database.transaction(async (tx) => {
    for (const entry of resolved) {
      await plan.apply(tx, entry);
    }
  });
}
