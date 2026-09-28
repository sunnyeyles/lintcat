/** Reads notifications off the queue. One batch per poll, at most ten messages. */
import { formatISO } from "date-fns";

import type { Notification } from "./delivery/transport.js";

export const BATCH_SIZE = 10;

export async function receiveBatch(queueUrl: string, now: Date): Promise<Notification[]> {
  const visibleAt = encodeURIComponent(formatISO(now));
  const response = await fetch(`${queueUrl}?max=${BATCH_SIZE}&visibleAt=${visibleAt}`);
  const body = (await response.json()) as { messages?: Notification[] };
  return body.messages ?? [];
}
