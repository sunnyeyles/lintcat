import { requiredEnv } from "@pr-review/db";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";
import { after } from "next/server";

export interface WorkerPingerConfig {
  url: string;
  secret: string;
  fetch?: typeof globalThis.fetch;
  logger: StructuredLogger;
}

/** Tells the worker to drain the queue now. Never throws or rejects; a failure only logs. */
export function createWorkerPinger({
  url,
  secret,
  fetch = globalThis.fetch,
  logger,
}: WorkerPingerConfig): () => Promise<void> {
  return async () => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      });
      if (!response.ok) logger.error("worker_ping.failed", { status: response.status });
    } catch (error: unknown) {
      logger.error("worker_ping.failed", { error: errorMessage(error) });
    }
  };
}

/** `() => void` so a caller cannot accidentally await it and slow its own response. */
export type PingWorker = () => void;

// No-op locally when WORKER_URL is unset; `after()` keeps a Vercel request alive for the ping.
export function hostedWorkerPinger(logger: StructuredLogger): PingWorker {
  const url = process.env.WORKER_URL?.trim();
  if (!url) return () => {};
  const ping = createWorkerPinger({ url, secret: requiredEnv("WORKER_PING_SECRET"), logger });
  return () => after(ping());
}
