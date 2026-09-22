import { createCapturingLogger } from "@pr-review/logging";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkerPinger, hostedWorkerPinger } from "@/lib/worker-ping";

describe("createWorkerPinger", () => {
  it("posts to the worker url with the shared secret as a bearer token", async () => {
    const calls: [string, RequestInit][] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response(null, { status: 202 });
    });
    const { logger } = createCapturingLogger();
    const ping = createWorkerPinger({
      url: "https://worker.example.test/",
      secret: "s3cr3t",
      fetch: fetch as unknown as typeof globalThis.fetch,
      logger,
    });

    await ping();

    expect(calls).toEqual([
      [
        "https://worker.example.test/",
        expect.objectContaining({
          method: "POST",
          headers: { authorization: "Bearer s3cr3t" },
        }),
      ],
    ]);
  });

  it("logs, but never throws, when the worker responds with an error status", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 500 }));
    const { logger, entries } = createCapturingLogger();
    const ping = createWorkerPinger({
      url: "https://worker.example.test/",
      secret: "s3cr3t",
      fetch: fetch as unknown as typeof globalThis.fetch,
      logger,
    });

    await expect(ping()).resolves.toBeUndefined();
    expect(entries).toContainEqual(
      expect.objectContaining({ event: "worker_ping.failed", status: 500 }),
    );
  });

  it("logs, but never throws or rejects, when the worker is unreachable", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("network blip");
    });
    const { logger, entries } = createCapturingLogger();
    const ping = createWorkerPinger({
      url: "https://worker.example.test/",
      secret: "s3cr3t",
      fetch: fetch as unknown as typeof globalThis.fetch,
      logger,
    });

    await expect(ping()).resolves.toBeUndefined();
    expect(entries).toContainEqual(
      expect.objectContaining({ event: "worker_ping.failed", error: "network blip" }),
    );
  });
});

describe("hostedWorkerPinger", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a no-op when WORKER_URL is unset, since a local worker just polls", async () => {
    vi.stubEnv("WORKER_URL", "");
    const { logger } = createCapturingLogger();
    const pingWorker = hostedWorkerPinger(logger);
    expect(() => pingWorker()).not.toThrow();
  });

  it("fails fast when WORKER_URL is set but WORKER_PING_SECRET is missing", () => {
    vi.stubEnv("WORKER_URL", "https://worker.example.test/");
    vi.stubEnv("WORKER_PING_SECRET", "");
    const { logger } = createCapturingLogger();
    expect(() => hostedWorkerPinger(logger)).toThrow(/WORKER_PING_SECRET/);
  });
});
