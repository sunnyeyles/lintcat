/** Reads notifications off the queue. One batch per poll, at most ten messages. */
import type { Notification } from "./delivery/transport.js";

export const BATCH_SIZE = 10;

export async function receiveBatch(queueUrl: string): Promise<Notification[]> {
  const response = await fetch(`${queueUrl}?max=${BATCH_SIZE}`);
  const body = (await response.json()) as { messages?: Notification[] };
  return body.messages ?? [];
}
