"use client";

import { Alert, AlertDescription, AlertTitle, Button, cn } from "@pr-review/design";
import { FolderGit2, Sparkles, TriangleAlert } from "@pr-review/design/icons";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";

import { readDrop, readFileList, type TraceFile } from "@/app/dev/run-trace/read-trace-files";
import { SAMPLE_TRACE } from "@/app/dev/run-trace/sample-trace";
import { formatDuration, timeBounds, walk } from "@/app/dev/run-trace/trace-layout";
import { TraceView } from "@/app/dev/run-trace/trace-view";
import { parseRun } from "@/lib/run-trace";
import type { RunTrace } from "@/lib/run-trace/types";

type Loaded = { trace: RunTrace; source: string; key: number };

export function RunTraceExplorer() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // React has no typed prop for webkitdirectory.
  useEffect(() => {
    inputRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  const show = (trace: RunTrace, source: string) => {
    setLoaded((previous) => ({ trace, source, key: (previous?.key ?? 0) + 1 }));
    setError(null);
  };

  const load = async (read: Promise<TraceFile[]>, source: string) => {
    setBusy(true);
    try {
      const files = await read;
      if (files.length === 0) throw new Error("No readable files in that selection.");
      show(parseRun(files), `${source} (${files.length} files)`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void load(readDrop(event.dataTransfer), "Dropped folder");
  };

  const trace = loaded?.trace;

  const summary = useMemo(() => {
    if (!trace) return null;
    const agents = [...walk(trace.root)];
    const bounds = timeBounds(trace.root);
    return { agents: agents.length, duration: formatDuration(bounds.end - bounds.start) };
  }, [trace]);

  return (
    <div className="space-y-4">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-4 py-3 transition-colors",
          dragging ? "border-primary bg-accent" : "bg-surface-2",
        )}
      >
        <FolderGit2 className="text-muted-foreground size-5" animate="none" />
        <p className="text-muted-foreground min-w-0 flex-1 text-sm">
          {busy
            ? "Reading trace…"
            : loaded
              ? (
                  <>
                    <span className="text-foreground font-medium">{loaded.trace.title ?? loaded.trace.sessionId}</span>
                    {" · "}
                    {summary?.agents} agents · {summary?.duration} · {loaded.source}
                  </>
                )
              : "Drop a run's trace folder here, or choose one."}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          aria-label="Trace folder"
          onChange={(event) => {
            const files = event.currentTarget.files;
            if (files) void load(readFileList(files), "Chosen folder");
            event.currentTarget.value = "";
          }}
        />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
          Choose folder
        </Button>
        <Button size="sm" disabled={busy} onClick={() => show(SAMPLE_TRACE, "Sample")}>
          <Sparkles animate="none" />
          Load sample
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <TriangleAlert animate="none" />
          <AlertTitle>Could not parse that run</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loaded ? <TraceView key={loaded.key} trace={loaded.trace} /> : null}
    </div>
  );
}
