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

/** Runs `deliver` until it succeeds or the attempts run out. */
export async function withAttempts<T>(
  maxAttempts: number,
  deliver: () => Promise<T>,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await deliver();
    } catch (error) {
      if (attempt >= maxAttempts) {
        logger.warn("delivery.attempts_exhausted", { attempt, maxAttempts });
        throw new DeliveryError(
          `delivery gave up after ${attempt} attempt(s)`,
          { cause: error },
        );
      }
      const wait = backoffMs(attempt);
      logger.info("delivery.retrying", { attempt, waitMs: Math.round(wait) });
      await sleep(wait);
    }
  }
}
