"use client";

import { Alert, AlertDescription, AlertTitle, Badge, Button, cn } from "@pr-review/design";
import { FolderGit2, Sparkles, TriangleAlert } from "@pr-review/design/icons";
import Link from "next/link";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";

import { FormatPicker } from "@/app/dev/run-trace/format-picker";
import { readDrop, readFileList, type TraceFile } from "@/app/dev/run-trace/read-trace-files";
import { SAMPLE_TRACE } from "@/app/dev/run-trace/sample-trace";
import { formatDuration, timeBounds, walk } from "@/app/dev/run-trace/trace-layout";
import { TraceView } from "@/app/dev/run-trace/trace-view";
import { findAdapter, parseTrace } from "@/lib/run-trace";
import type { RunTrace } from "@/lib/run-trace/types";

type Loaded = { files: TraceFile[] | null; sample?: RunTrace; source: string; key: number };

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export function RunTraceExplorer() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [format, setFormat] = useState<string | undefined>(undefined);
  const [readError, setReadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef<HTMLInputElement | null>(null);

  // React has no typed prop for webkitdirectory.
  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  const load = async (read: Promise<TraceFile[]>, source: string) => {
    setBusy(true);
    try {
      const files = await read;
      if (files.length === 0) throw new Error("No .json, .jsonl, .ndjson or .zip files in that selection.");
      setFormat(undefined);
      setReadError(null);
      setLoaded((previous) => ({ files, source: `${source} (${files.length} files)`, key: (previous?.key ?? 0) + 1 }));
    } catch (cause) {
      setReadError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const parsed = useMemo(() => {
    if (!loaded) return null;
    if (loaded.sample) return { trace: loaded.sample, error: null };
    try {
      return { trace: parseTrace(loaded.files ?? [], format).trace, error: null };
    } catch (cause) {
      return { trace: null, error: errorText(cause) };
    }
  }, [loaded, format]);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void load(readDrop(event.dataTransfer), "Dropped");
  };

  const trace = parsed?.trace ?? null;
  const summary = useMemo(() => {
    if (!trace) return null;
    const bounds = timeBounds(trace.root);
    return { agents: [...walk(trace.root)].length, duration: formatDuration(bounds.end - bounds.start) };
  }, [trace]);
  const error = readError ?? parsed?.error ?? null;

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
          {busy ? (
            "Reading trace…"
          ) : trace && loaded ? (
            <>
              <span className="text-foreground font-medium">{trace.title ?? trace.sessionId}</span>
              {" · "}
              {summary?.agents} agents · {summary?.duration} · {loaded.source}
            </>
          ) : (
            "Drop a run's trace folder, files or a .zip here, or choose one."
          )}
        </p>
        {trace?.format ? <Badge variant="secondary">{findAdapter(trace.format)?.label ?? trace.format}</Badge> : null}
        <input
          ref={folderRef}
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
        <input
          ref={filesRef}
          type="file"
          multiple
          hidden
          accept=".json,.jsonl,.ndjson,.zip,.md"
          aria-label="Trace files"
          onChange={(event) => {
            const files = event.currentTarget.files;
            if (files) void load(readFileList(files), "Chosen files");
            event.currentTarget.value = "";
          }}
        />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => folderRef.current?.click()}>
          Choose folder
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => filesRef.current?.click()}>
          Choose files
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            setReadError(null);
            setLoaded((previous) => ({ files: null, sample: SAMPLE_TRACE, source: "Sample", key: (previous?.key ?? 0) + 1 }));
          }}
        >
          <Sparkles animate="none" />
          Load sample
        </Button>
      </div>

      {loaded?.files ? (
        <FormatPicker files={loaded.files} value={format} used={trace?.format} onChange={setFormat} />
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <TriangleAlert animate="none" />
          <AlertTitle>Couldn&rsquo;t read this run</AlertTitle>
          <AlertDescription>
            <p className="whitespace-pre-wrap">{error}</p>
            <p>
              See <Link href="/docs/plug-in-your-factory" className="underline">Plug in your factory</Link> for the formats
              and how to export them.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {trace && loaded ? <TraceView key={`${loaded.key}-${trace.format ?? "sample"}`} trace={trace} /> : null}
    </div>
  );
}
