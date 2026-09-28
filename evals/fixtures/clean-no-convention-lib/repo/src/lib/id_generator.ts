import { randomUUID } from "node:crypto";

/** Invoice ids are opaque; the prefix only helps a human reading logs. */
export default function generateId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}
