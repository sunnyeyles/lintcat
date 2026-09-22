import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { errorMessage, type StructuredLogger } from "@pr-review/logging";

export interface WorkerServerConfig {
  secret: string;
}

function validSecret(secret: string, header: string | null): boolean {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Collapses concurrent pings into one drain, so a burst of pings runs the queue once. */
export function createDrainer(runOnce: () => Promise<number>): () => Promise<number> {
  let inFlight: Promise<number> | undefined;
  return () => {
    inFlight ??= runOnce().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
}

/** The ping endpoint: an authenticated POST drains the queue once and reports how many jobs ran. */
export async function handleWorkerRequest(
  request: Request,
  drain: () => Promise<number>,
  { secret }: WorkerServerConfig,
): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 404 });
  if (!validSecret(secret, request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const processed = await drain();
  return Response.json({ processed }, { status: 200 });
}

function toWebRequest(request: IncomingMessage): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  return new Request(`http://localhost${request.url ?? "/"}`, {
    method: request.method,
    headers,
  });
}

async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(response.body ? await response.text() : undefined);
}

/** Cloud Run's entrypoint: one HTTP endpoint the webhook's ping and Cloud Scheduler's sweep both hit. */
export function createHttpServer(
  drain: () => Promise<number>,
  config: WorkerServerConfig,
  logger: StructuredLogger,
): Server {
  return createServer((req, res) => {
    handleWorkerRequest(toWebRequest(req), drain, config)
      .then((response) => sendWebResponse(res, response))
      .catch((error: unknown) => {
        logger.error("worker_server.request_failed", { error: errorMessage(error) });
        res.statusCode = 500;
        res.end();
      });
  });
}

export function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve) => server.listen(port, resolve));
}
