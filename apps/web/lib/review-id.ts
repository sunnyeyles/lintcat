// Null unless the URL segment can name a row: a positive int4.
export function parseReviewId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 && id <= 2 ** 31 - 1 ? id : null;
}
