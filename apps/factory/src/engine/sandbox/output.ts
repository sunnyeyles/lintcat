import { createHash } from "node:crypto";

import { redact } from "@pr-review/logging";

export const HEAD_BYTES = 16 * 1024;
export const TAIL_BYTES = 48 * 1024;

/** Keeps the first and last bytes of a stream without holding the middle in memory. */
export class BoundedOutput {
  private head = Buffer.alloc(0);
  private tail: Buffer[] = [];
  private tailLength = 0;
  private total = 0;

  push(chunk: Buffer): void {
    this.total += chunk.length;
    if (this.head.length < HEAD_BYTES) {
      const take = Math.min(HEAD_BYTES - this.head.length, chunk.length);
      this.head = Buffer.concat([this.head, chunk.subarray(0, take)]);
      chunk = chunk.subarray(take);
    }
    if (chunk.length === 0) return;
    this.tail.push(chunk);
    this.tailLength += chunk.length;
    while (this.tailLength > TAIL_BYTES) {
      const first = this.tail[0]!;
      const excess = this.tailLength - TAIL_BYTES;
      if (first.length <= excess) {
        this.tail.shift();
        this.tailLength -= first.length;
      } else {
        this.tail[0] = first.subarray(excess);
        this.tailLength -= excess;
      }
    }
  }

  text(): string {
    const tail = Buffer.concat(this.tail).toString("utf8");
    const dropped = this.total - this.head.length - this.tailLength;
    if (dropped <= 0) return this.head.toString("utf8") + tail;
    return `${this.head.toString("utf8")}\n…[truncated ${dropped} bytes]…\n${tail}`;
  }
}

export function boundOutput(text: string): string {
  const bounded = new BoundedOutput();
  bounded.push(Buffer.from(text, "utf8"));
  return bounded.text();
}

export function hashOutput(output: string): string {
  const normalised = output
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<ts>")
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,}\b/gi, "<hex>")
    .replace(/\d+/g, "0");
  return createHash("sha256").update(normalised).digest("hex");
}

export function finishOutput(raw: string, secrets: readonly string[]): { output: string; outputHash: string } {
  const output = redact(raw, secrets);
  return { output, outputHash: hashOutput(output) };
}
