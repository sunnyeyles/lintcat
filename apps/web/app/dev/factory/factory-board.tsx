"use client";

import { Badge, Button, Card, cn } from "@pr-review/design";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { elapsed, groupFactoryRuns, type BoardRun } from "@/app/dev/factory/board";
import { CastFigure } from "@/app/dev/run-trace/bot-figure";
import {
  fetchRunTrace,
  POLL_MS,
  runPath,
  useRunTraceToken,
  type LiveRunList,
  type LiveRunSummary,
} from "@/app/dev/run-trace/live-api";
import { TokenForm } from "@/app/dev/run-trace/live-runs";

const STATUS_LABEL: Record<string, string> = {
  awaiting_approval: "awaiting approval",
};

function statusLabel(status?: string): string {
  return status ? (STATUS_LABEL[status] ?? status) : "unknown";
}

function InProgressCard({ run, now }: { run: BoardRun; now: number }) {
  return (
    <Link
      href={runPath("/dev/run-trace", run)}
      className="bg-card hover:bg-surface-2 flex flex-col items-center gap-2 rounded-lg border p-4 text-center"
    >
      <CastFigure role={run.cast} status={run.stalled ? undefined : "running"} px={120} />
      <span className="line-clamp-2 text-sm font-medium">{run.title ?? run.runId}</span>
      <span className="flex flex-wrap justify-center gap-1">
        <Badge>{run.stage ?? statusLabel(run.status)}</Badge>
        {run.profile ? <Badge variant="outline">{run.profile}</Badge> : null}
        {run.stalled ? <Badge variant="destructive">stalled</Badge> : null}
      </span>
      <span className="text-muted-foreground text-xs tabular-nums">{elapsed(run.startedAt, now)}</span>
    </Link>
  );
}

function RunRow({ run, finished }: { run: BoardRun; finished?: boolean }) {
  const status = finished ? (run.status === "delivered" ? "done" : "failed") : undefined;
  return (
    <li>
      <Link
        href={runPath("/dev/run-trace", run)}
        className="hover:bg-surface-2 flex items-center gap-3 rounded-sm px-2 py-1 text-sm"
      >
        <CastFigure role={run.cast} status={status} px={40} />
        <span className={cn("min-w-0 flex-1 truncate", !run.title && "text-muted-foreground")}>
          {run.title ?? run.runId}
        </span>
        {run.profile ? <span className="text-muted-foreground shrink-0 text-xs">{run.profile}</span> : null}
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {new Date(finished ? run.lastSeenAt : run.startedAt).toLocaleString()}
        </span>
        <Badge variant={run.status === "failed" ? "destructive" : "outline"}>{statusLabel(run.status)}</Badge>
      </Link>
    </li>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <Card className="gap-3 px-4 py-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {title}
        <Badge variant="outline" className="tabular-nums">
          {count}
        </Badge>
      </h2>
      {children}
    </Card>
  );
}

export function FactoryBoard() {
  const [token, setToken] = useRunTraceToken();
  const [runs, setRuns] = useState<LiveRunSummary[] | null>(null);
  const [rejected, setRejected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceErrors, setSourceErrors] = useState<LiveRunList["errors"]>([]);
  const [now, setNow] = useState(() => Date.now());

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
        setNow(Date.now());
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [token, setToken]);

  if (!token) {
    return (
      <Card className="gap-3 px-4 py-3">
        <TokenForm
          invalid={rejected}
          onSave={(next) => {
            setRejected(false);
            setToken(next);
          }}
        />
      </Card>
    );
  }
  if (error) return <p className="text-destructive text-sm">{error}</p>;
  if (runs === null) return <p className="text-muted-foreground text-sm">Loading…</p>;

  const board = groupFactoryRuns(runs, now);
  const factoryErrors = sourceErrors?.filter((item) => item.source === "factory") ?? [];
  const connected = runs.some((run) => run.source === "factory") || factoryErrors.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button size="xs" variant="ghost" onClick={() => setToken(null)}>
          Forget token
        </Button>
      </div>
      {factoryErrors.map((item) => (
        <p key={item.source} className="text-destructive text-sm">
          Could not read the factory database: {item.error}
        </p>
      ))}
      {!connected ? (
        <p className="text-muted-foreground text-sm">
          No factory runs. Set <code>FACTORY_DATABASE_URL</code> on the web app to read the factory&apos;s Postgres.
        </p>
      ) : null}
      <Section title="In progress" count={board.inProgress.length}>
        {board.inProgress.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing is running.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
            {board.inProgress.map((run) => (
              <InProgressCard key={run.runId} run={run} now={now} />
            ))}
          </div>
        )}
      </Section>
      <Section title="Waiting" count={board.waiting.length}>
        {board.waiting.length === 0 ? (
          <p className="text-muted-foreground text-sm">No queued or unapproved runs.</p>
        ) : (
          <ul className="divide-y">
            {board.waiting.map((run) => (
              <RunRow key={run.runId} run={run} />
            ))}
          </ul>
        )}
      </Section>
      <Section title="Recently finished" count={board.finished.length}>
        {board.finished.length === 0 ? (
          <p className="text-muted-foreground text-sm">No finished runs yet.</p>
        ) : (
          <ul className="divide-y">
            {board.finished.map((run) => (
              <RunRow key={run.runId} run={run} finished />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
