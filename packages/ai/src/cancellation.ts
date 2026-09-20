/** Cancellation, kept distinct from failure everywhere a review can stop. */

export class ReviewCancelledError extends Error {
  constructor(message = "the review was cancelled") {
    super(message);
    this.name = "ReviewCancelledError";
  }
}

/** An aborted signal makes whatever the call threw a cancellation. */
export function isCancellation(
  error: unknown,
  signal?: AbortSignal | undefined,
): boolean {
  if (error instanceof ReviewCancelledError || signal?.aborted === true) {
    return true;
  }
  return error instanceof Error && error.name === "AbortError";
}

export function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new ReviewCancelledError();
  }
}
