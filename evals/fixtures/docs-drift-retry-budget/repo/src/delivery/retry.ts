/**
 * The delivery retry loop. Backoff doubles each time and is jittered, so
 * two workers failing on the same endpoint do not retry in lockstep.
 */
import { logger } from "../logging.js";
import { DeliveryError } from "./errors.js";

/** Milliseconds waited before the second attempt; every later wait doubles it. */
export const BASE_BACKOFF_MS = 250;

/** The longest single wait between two attempts. */
export const MAX_BACKOFF_MS = 8_000;

function backoffMs(attempt: number): number {
  const doubled = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  const capped = Math.min(doubled, MAX_BACKOFF_MS);
  return capped / 2 + Math.random() * (capped / 2);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `deliver` until it succeeds or the next wait would outlast the budget. */
export async function withRetryBudget<T>(
  budgetMs: number,
  deliver: () => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + budgetMs;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await deliver();
    } catch (error) {
      const wait = backoffMs(attempt);
      if (Date.now() + wait >= deadline) {
        logger.warn("delivery.budget_exhausted", { attempt, budgetMs });
        throw new DeliveryError(
          `delivery gave up after ${attempt} attempt(s) within ${budgetMs}ms`,
          { cause: error },
        );
      }
      logger.info("delivery.retrying", { attempt, waitMs: Math.round(wait) });
      await sleep(wait);
    }
  }
}
