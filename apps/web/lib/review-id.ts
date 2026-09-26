const MAX_SERIAL = 2 ** 31 - 1;

/** A review id from the URL, or null when it cannot name a row (positive int4). */
export function parseReviewId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 && id <= MAX_SERIAL ? id : null;
}
