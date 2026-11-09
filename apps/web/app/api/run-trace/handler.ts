import { createHash, timingSafeEqual } from "node:crypto";

import {
  findRunTrace,
  listRunTraces,
  saveRunTraceFiles,
  type Database,
  type RunTraceFileInput,
} from "@pr-review/db";
import { z } from "zod";

import { parseRun } from "@/lib/run-trace";

export type RunTraceDeps = { database: Database; token: string | undefined; now: () => Date };

const MAX_BODY_BYTES = 64 * 1024 * 1024;
const RUN_ID = /^[A-Za-z0-9_-]{1,128}$/;
const AGENT_FILE = /^agent-[A-Za-z0-9_-]{1,128}\.(jsonl|meta\.json)$/;

const IngestBody = z.object({
  files: z.array(z.object({ name: z.string(), text: z.string() })).max(500),
});

const notFound = () => Response.json({ error: "not found" }, { status: 404 });

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

// A missing or wrong token reads as 404, so the endpoint does not advertise itself.
function authorized(request: Request, token: string | undefined): boolean {
  if (!token) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  return timingSafeEqual(digest(given), digest(token));
}

export function isTraceFileName(runId: string, name: string): boolean {
  if (name === `${runId}.jsonl`) return true;
  const prefix = `${runId}/subagents/`;
  return name.startsWith(prefix) && AGENT_FILE.test(name.slice(prefix.length));
}

async function readBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new RangeError("too large");
  let stream = request.body;
  if (!stream) return undefined;
  if (request.headers.get("content-encoding") === "gzip") {
    stream = stream.pipeThrough(new DecompressionStream("gzip"));
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = stream.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError("too large");
    }
    chunks.push(read.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function titleOf(runId: string, files: readonly RunTraceFileInput[]): string | undefined {
  const main = files.find((file) => file.name === `${runId}.jsonl`);
  if (!main) return undefined;
  try {
    return parseRun([main]).title;
  } catch {
    return undefined;
  }
}

export async function handleRunTraceIngest(
  request: Request,
  runId: string,
  deps: RunTraceDeps,
): Promise<Response> {
  if (!authorized(request, deps.token) || !RUN_ID.test(runId)) return notFound();
  let body: unknown;
  try {
    body = await readBody(request);
  } catch (cause) {
    if (cause instanceof RangeError) return Response.json({ error: "too large" }, { status: 413 });
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = IngestBody.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
  const { files } = parsed.data;
  const bad = files.find((file) => !isTraceFileName(runId, file.name));
  if (bad) return Response.json({ error: `unexpected file ${bad.name}` }, { status: 400 });

  await saveRunTraceFiles(deps.database, runId, files, {
    title: titleOf(runId, files),
    now: deps.now(),
  });
  return Response.json({ ok: true, files: files.length });
}

export async function handleRunTraceRead(
  request: Request,
  runId: string,
  deps: RunTraceDeps,
): Promise<Response> {
  if (!authorized(request, deps.token) || !RUN_ID.test(runId)) return notFound();
  const found = await findRunTrace(deps.database, runId);
  if (!found) return notFound();
  return Response.json(found, { headers: { "cache-control": "no-store" } });
}

export async function handleRunTraceList(request: Request, deps: RunTraceDeps): Promise<Response> {
  if (!authorized(request, deps.token)) return notFound();
  const runs = await listRunTraces(deps.database);
  return Response.json({ runs }, { headers: { "cache-control": "no-store" } });
}
