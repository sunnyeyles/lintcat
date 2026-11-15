import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import { createDrainer, createHttpServer, handleWorkerRequest, listen } from "#src/server";

const SECRET = "ping-secret";

function request(init: { method?: string; authorization?: string } = {}): Request {
  const headers = new Headers();
  if (init.authorization !== undefined) headers.set("authorization", init.authorization);
  return new Request("https://worker.example.test/", {
    method: init.method ?? "POST",
    headers,
  });
}

describe("handleWorkerRequest", () => {
  it("rejects a request carrying no secret, and drains nothing", async () => {
    let drains = 0;
    const response = await handleWorkerRequest(request(), async () => {
      drains += 1;
      return 0;
    }, { secret: SECRET });
    expect(response.status).toBe(401);
    expect(drains).toBe(0);
  });

  it("rejects the wrong secret, and drains nothing", async () => {
    let drains = 0;
    const response = await handleWorkerRequest(
      request({ authorization: "Bearer wrong" }),
      async () => {
        drains += 1;
        return 0;
      },
      { secret: SECRET },
    );
    expect(response.status).toBe(401);
    expect(drains).toBe(0);
  });

  it("drains the queue once the shared secret matches", async () => {
    let drains = 0;
    const response = await handleWorkerRequest(
      request({ authorization: `Bearer ${SECRET}` }),
      async () => {
        drains += 1;
        return 3;
      },
      { secret: SECRET },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 3 });
    expect(drains).toBe(1);
  });

  it("404s any method other than POST", async () => {
    let drains = 0;
    const response = await handleWorkerRequest(
      request({ method: "GET", authorization: `Bearer ${SECRET}` }),
      async () => {
        drains += 1;
        return 0;
      },
      { secret: SECRET },
    );
    expect(response.status).toBe(404);
    expect(drains).toBe(0);
  });
});

describe("createDrainer", () => {
  it("shares one in-flight drain between concurrent callers", async () => {
    let calls = 0;
    let resolveRun: (n: number) => void = () => {};
    const runWorker = () =>
      new Promise<number>((resolve) => {
        calls += 1;
        resolveRun = resolve;
      });
    const drain = createDrainer(runWorker);

    const first = drain();
    const second = drain();
    resolveRun(2);

    expect(await first).toBe(2);
    expect(await second).toBe(2);
    expect(calls).toBe(1);
  });

  it("starts a fresh drain once the previous one settles", async () => {
    let calls = 0;
    const runWorker = async () => {
      calls += 1;
      return calls;
    };
    const drain = createDrainer(runWorker);

    expect(await drain()).toBe(1);
    expect(await drain()).toBe(2);
    expect(calls).toBe(2);
  });
});

describe("createHttpServer", () => {
  it("logs the cause of a failed drain, which holds the database's own reason", async () => {
    const logged: { event: string; fields?: Record<string, unknown> }[] = [];
    const failure = new Error("Failed query: update review_jobs", {
      cause: new Error('column "lease_expires_at" does not exist'),
    });
    const server = createHttpServer(
      () => Promise.reject(failure),
      { secret: SECRET },
      { info() {}, error: (event, fields) => logged.push({ event, fields }) },
    );
    await listen(server, 0);
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}` },
      });
      expect(response.status).toBe(500);
    } finally {
      server.close();
    }
    expect(logged).toEqual([
      {
        event: "worker_server.request_failed",
        fields: {
          error: "Failed query: update review_jobs",
          cause: 'column "lease_expires_at" does not exist',
        },
      },
    ]);
  });
});
