/** A bounded read of one file: the lines asked for, headed by where they sit. */

export interface LineRange {
  startLine?: number | undefined;
  endLine?: number | undefined;
}

/** No range returns the content whole; a 1-based inclusive range is clamped to the file. */
export function sliceLines(content: string, range: LineRange = {}): string {
  if (range.startLine === undefined && range.endLine === undefined) {
    return content;
  }
  const lines = content.split("\n");
  const total = lines.length;
  const start = Math.max(1, Math.min(range.startLine ?? 1, total));
  const end = Math.max(start, Math.min(range.endLine ?? total, total));
  return [`[lines ${start}-${end} of ${total}]`, ...lines.slice(start - 1, end)].join("\n");
}
