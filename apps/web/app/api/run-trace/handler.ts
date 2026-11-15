import { createHash, timingSafeEqual } from "node:crypto";

import {
  findRunTrace,
  listRunTraces,
  saveRunTraceFiles,
  type Database,
  type RunTraceFileInput,
} from "@pr-review/db";
import { z } from "zod";

import { detectFormat, findAdapter, FORMAT_IDS, parseTrace } from "@/lib/run-trace";
import type { RunTraceConnector, TraceRunSummary } from "@/lib/run-trace/connectors/types";

export type RunTraceDeps = {
  database: Database;
  token: string | undefined;
  now: () => Date;
  connectors?: readonly RunTraceConnector[];
  maxBodyBytes?: number;
};

const MAX_BODY_BYTES = 64 * 1024 * 1024;
const RUN_ID = /^[A-Za-z0-9_-]{1,128}$/;
const AGENT_FILE = /^agent-[A-Za-z0-9_-]{1,128}\.(jsonl|meta\.json)$/;
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$|^\.[A-Za-z0-9_][A-Za-z0-9._-]{0,126}$/;
const TRACE_EXTENSION = /\.(jsonl|ndjson|json|md)$/;
const PUSH_SOURCE = "push";

const IngestBody = z.object({
  format: z.string().max(64).optional(),
  files: z.array(z.object({ name: z.string().max(512), text: z.string() })).max(500),
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

/** Any other format: a relative path of at most five plain segments, with a trace extension. */
export function isSafeFileName(name: string): boolean {
  const segments = name.split("/");
  return segments.length <= 5 && segments.every((segment) => SEGMENT.test(segment)) && TRACE_EXTENSION.test(name);
}

async function readBody(request: Request, limit: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > limit) throw new RangeError("too large");
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
    if (size > limit) {
      await reader.cancel();
      throw new RangeError("too large");
    }
    chunks.push(read.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function titleOf(runId: string, format: string, files: readonly RunTraceFileInput[]): string | undefined {
  const named = format === "claude-code" ? files.filter((file) => file.name === `${runId}.jsonl`) : files;
  if (named.length === 0) return undefined;
  try {
    return parseTrace(named, format).trace.title;
  } catch {
    return undefined;
  }
}

const unsupported = (error: string) =>
  Response.json({ error, supported: FORMAT_IDS, docs: "/docs/plug-in-your-factory" }, { status: 400 });

export async function handleRunTraceIngest(
  request: Request,
  runId: string,
  deps: RunTraceDeps,
): Promise<Response> {
  if (!authorized(request, deps.token) || !RUN_ID.test(runId)) return notFound();
  let body: unknown;
  try {
    body = await readBody(request, deps.maxBodyBytes ?? MAX_BODY_BYTES);
  } catch (cause) {
    if (cause instanceof RangeError) return Response.json({ error: "too large" }, { status: 413 });
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = IngestBody.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
  const { files } = parsed.data;
  if (parsed.data.format && !findAdapter(parsed.data.format)) {
    return unsupported(`unknown format "${parsed.data.format}"`);
  }
  const format =
    parsed.data.format ??
    detectFormat(files)?.id ??
    (await findRunTrace(deps.database, runId))?.run.format ??
    undefined;
  if (!format) return unsupported("couldn't detect the format of these files");

  const allowed = format === "claude-code" ? (name: string) => isTraceFileName(runId, name) : isSafeFileName;
  const bad = files.find((file) => !allowed(file.name));
  if (bad) return Response.json({ error: `unexpected file ${bad.name}` }, { status: 400 });

  await saveRunTraceFiles(deps.database, runId, files, {
    title: titleOf(runId, format, files),
    format,
    now: deps.now(),
  });
  return Response.json({ ok: true, format, files: files.length });
}

function connectorFor(request: Request, deps: RunTraceDeps): RunTraceConnector | "push" | undefined {
  const source = new URL(request.url).searchParams.get("source") ?? PUSH_SOURCE;
  if (source === PUSH_SOURCE) return PUSH_SOURCE;
  return deps.connectors?.find((connector) => connector.id === source);
}

export async function handleRunTraceRead(
  request: Request,
  runId: string,
  deps: RunTraceDeps,
): Promise<Response> {
  if (!authorized(request, deps.token) || !RUN_ID.test(runId)) return notFound();
  const source = connectorFor(request, deps);
  if (!source) return notFound();
  const found = source === PUSH_SOURCE ? await findRunTrace(deps.database, runId) : await source.read(runId);
  if (!found) return notFound();
  const sourceId = source === PUSH_SOURCE ? PUSH_SOURCE : source.id;
  return Response.json({ ...found, run: { ...found.run, source: sourceId } }, { headers: { "cache-control": "no-store" } });
}

export async function handleRunTraceList(request: Request, deps: RunTraceDeps): Promise<Response> {
  if (!authorized(request, deps.token)) return notFound();
  const errors: { source: string; error: string }[] = [];
  const lists: { id: string; list: () => Promise<TraceRunSummary[]> }[] = [
    { id: PUSH_SOURCE, list: () => listRunTraces(deps.database) },
    ...(deps.connectors ?? []).map((connector) => ({ id: connector.id, list: () => connector.list(50) })),
  ];
  // One unreachable source must not hide the others' runs.
  const listed = await Promise.all(
    lists.map(async (source) => {
      try {
        return (await source.list()).map((run) => ({ ...run, source: source.id }));
      } catch (cause) {
        errors.push({ source: source.id, error: cause instanceof Error ? cause.message : String(cause) });
        return [];
      }
    }),
  );
  const runs = listed.flat().sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
  return Response.json({ runs, sources: lists.map((source) => source.id), errors }, { headers: { "cache-control": "no-store" } });
}
