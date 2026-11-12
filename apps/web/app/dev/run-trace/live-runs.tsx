"use client";

import { Badge, Button, Card, Input, cn } from "@pr-review/design";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";

import {
  fetchRunTrace,
  isLive,
  POLL_MS,
  runPath,
  useRunTraceToken,
  type LiveRunList,
  type LiveRunSummary,
} from "@/app/dev/run-trace/live-api";
import { findAdapter } from "@/lib/run-trace";

export function TokenForm({ onSave, invalid }: { onSave: (token: string) => void; invalid?: boolean }) {
  const [value, setValue] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) onSave(value.trim());
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <Input
        type="password"
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        placeholder="RUN_TRACE_TOKEN"
        aria-label="Run trace token"
        aria-invalid={invalid || undefined}
        className="max-w-xs"
      />
      <Button type="submit" size="sm">
        Show live runs
      </Button>
      {invalid ? <span className="text-destructive text-sm">That token was not accepted.</span> : null}
    </form>
  );
}

export function LiveRuns() {
  const [token, setToken] = useRunTraceToken();
  const [runs, setRuns] = useState<LiveRunSummary[] | null>(null);
  const [rejected, setRejected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceErrors, setSourceErrors] = useState<LiveRunList["errors"]>([]);

  useEffect(() => {
    if (!token) return;
    let stopped = false;
    const tick = async () => {
      try {
        const body = await fetchRunTrace<LiveRunList>("/api/run-trace", token);
        if (stopped) return;
        if (!body) {
          setRejected(true);
          setToken(null);
          return;
        }
        setRuns(body.runs);
        setSourceErrors(body.errors ?? []);
        setError(null);
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS * 3);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [token, setToken]);

  return (
    <Card className="gap-3 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Pushed and connected runs</h2>
        {token ? (
          <Button size="xs" variant="ghost" onClick={() => setToken(null)}>
            Forget token
          </Button>
        ) : null}
      </div>
      {!token ? (
        <TokenForm
          invalid={rejected}
          onSave={(next) => {
            setRejected(false);
            setToken(next);
          }}
        />
      ) : error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : runs === null ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No runs yet. Push one to <code>/api/run-trace/&lt;runId&gt;</code>, or set{" "}
          <code>FACTORY_DATABASE_URL</code> to read the factory&rsquo;s runs.
        </p>
      ) : (
        <ul className="divide-y">
          {runs.map((run) => (
            <li key={`${run.source}:${run.runId}`}>
              <Link
                href={runPath("/dev/run-trace", run)}
                className="hover:bg-surface-2 flex items-center gap-3 rounded-sm px-2 py-2 text-sm"
              >
                <span className={cn("min-w-0 flex-1 truncate", !run.title && "text-muted-foreground")}>
                  {run.title ?? run.runId}
                </span>
                {run.format ? (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {findAdapter(run.format)?.label ?? run.format}
                    {run.source !== "push" ? ` · ${run.source}` : ""}
                  </span>
                ) : null}
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {new Date(run.lastSeenAt).toLocaleString()}
                </span>
                {isLive(run) ? <Badge>live</Badge> : <Badge variant="outline">finished</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {sourceErrors?.map((item) => (
        <p key={item.source} className="text-destructive text-sm">
          Could not read {item.source}: {item.error}
        </p>
      ))}
    </Card>
  );
}
