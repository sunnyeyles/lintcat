"use client";

import { Alert, AlertDescription, AlertTitle, Badge } from "@pr-review/design";
import { TriangleAlert } from "@pr-review/design/icons";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  fetchRunTrace,
  isLive,
  POLL_MS,
  useRunTraceToken,
  type LiveRunFiles,
} from "@/app/dev/run-trace/live-api";
import { TokenForm } from "@/app/dev/run-trace/live-runs";
import { formatDuration, timeBounds, walk } from "@/app/dev/run-trace/trace-layout";
import { TraceView } from "@/app/dev/run-trace/trace-view";
import { parseRun } from "@/lib/run-trace";

export function LiveRunTrace({ runId }: { runId: string }) {
  const [token, setToken] = useRunTraceToken();
  const [data, setData] = useState<LiveRunFiles | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let seen = "";
    const tick = async () => {
      try {
        const body = await fetchRunTrace<LiveRunFiles>(`/api/run-trace/${runId}`, token);
        if (stopped) return;
        if (!body) {
          setMissing(true);
          return;
        }
        if (body.run.lastSeenAt !== seen || !isLive(body.run)) {
          seen = body.run.lastSeenAt;
          setData(body);
        }
        setError(null);
        if (!isLive(body.run)) return;
      } catch (cause) {
        if (stopped) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [runId, token]);

  const parsed = useMemo(() => {
    if (!data) return null;
    try {
      return { trace: parseRun(data.files), error: null };
    } catch (cause) {
      return { trace: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [data]);

  if (!token) return <TokenForm onSave={setToken} />;
  if (missing) {
    return (
      <p className="text-muted-foreground text-sm">
        No run {runId}, or the saved token is wrong.{" "}
        <button type="button" className="underline" onClick={() => setToken(null)}>
          Enter it again
        </button>
        .
      </p>
    );
  }
  if (!data || !parsed) return <p className="text-muted-foreground text-sm">Loading…</p>;

  const trace = parsed.trace;
  const live = isLive(data.run);
  const bounds = trace ? timeBounds(trace.root) : null;

  return (
    <div className="space-y-4">
      <div className="bg-surface-2 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm">
        <Link href="/dev/run-trace" className="text-muted-foreground hover:text-foreground">
          All runs
        </Link>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{trace?.title ?? data.run.title ?? runId}</span>
          {trace && bounds ? (
            <span className="text-muted-foreground">
              {" · "}
              {[...walk(trace.root)].length} agents · {formatDuration(bounds.end - bounds.start)} ·{" "}
              {data.files.length} files
            </span>
          ) : null}
        </span>
        {live ? <Badge>live</Badge> : <Badge variant="outline">finished</Badge>}
      </div>

      {error || parsed.error ? (
        <Alert variant="destructive">
          <TriangleAlert animate="none" />
          <AlertTitle>{parsed.error ? "Could not parse this run" : "Could not refresh"}</AlertTitle>
          <AlertDescription>{parsed.error ?? error}</AlertDescription>
        </Alert>
      ) : null}

      {trace ? <TraceView trace={trace} live={live} /> : null}
    </div>
  );
}
