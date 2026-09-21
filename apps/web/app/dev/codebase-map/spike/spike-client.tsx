"use client";

import { Button } from "@pr-review/design";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { MapCanvas } from "@/components/codebase-map/map-canvas";
import { usePalette } from "@/components/codebase-map/palette";
import { buildScene } from "@/components/codebase-map/scene";
import { runPanZoom, type BenchResult } from "@/components/codebase-map/spike/bench";
import { MapSigma } from "@/components/codebase-map/spike/map-sigma";
import { MapSvg } from "@/components/codebase-map/spike/map-svg";
import type { MapHandle } from "@/components/codebase-map/view";
import { groupIdFor, normaliseGraph, sampleRepo } from "@/lib/codebase-map";

const RENDERERS = ["canvas", "svg", "sigma"] as const;
const SIZES = [1000, 5000, 10000] as const;
type Renderer = (typeof RENDERERS)[number];

declare global {
  interface Window {
    __spikeRun?: () => Promise<BenchResult>;
    __spikeSet?: (renderer: Renderer, files: number) => void;
    __spikeFocus?: () => Promise<FocusResult>;
  }
}

const SURFACE = "h-[600px] w-full rounded-lg border border-border bg-surface-1";

export interface FocusResult {
  renderer: Renderer;
  files: number;
  samples: number;
  commitMs: number;
  frameMs: number;
}

export function SpikeClient() {
  const [renderer, setRenderer] = useState<Renderer>("canvas");
  const [files, setFiles] = useState<number>(5000);
  const [focused, setFocused] = useState<string | null>(null);
  const [results, setResults] = useState<BenchResult[]>([]);
  const [running, setRunning] = useState(false);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const handleRef = useRef<MapHandle | null>(null);
  const palette = usePalette(host);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const wanted = query.get("renderer");
    if (RENDERERS.includes(wanted as Renderer)) setRenderer(wanted as Renderer);
    const size = Number(query.get("files"));
    if (Number.isFinite(size) && size > 0) setFiles(size);
  }, []);

  const graph = useMemo(() => normaliseGraph(sampleRepo(7, files)), [files]);

  // The spike measures the worst case, so no group is left collapsed.
  const scene = useMemo(() => {
    const expandedGroups = new Set(graph.files.map(groupIdFor));
    return buildScene(graph, { focusedPath: focused, query: "", expandedGroups });
  }, [graph, focused]);

  useEffect(() => {
    const id = setTimeout(() => handleRef.current?.fit(), 50);
    return () => clearTimeout(id);
  }, [scene, renderer]);

  const run = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle) throw new Error("no renderer mounted");
    setRunning(true);
    const result = await runPanZoom(handle, {
      renderer,
      files,
      nodes: scene.nodes.length,
      edges: scene.edges.length,
    });
    setResults((previous) => [...previous, result]);
    setRunning(false);
    return result;
  }, [files, renderer, scene]);

  const focusBench = useCallback(async (): Promise<FocusResult> => {
    const paths = graph.files.map((file) => file.path);
    const commits: number[] = [];
    const frames: number[] = [];
    for (let i = 1; i <= 6; i += 1) {
      const path = paths[Math.floor((paths.length * i) / 8)]!;
      const start = performance.now();
      flushSync(() => setFocused(path));
      commits.push(performance.now() - start);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      frames.push(performance.now() - start);
    }
    const mean = (values: number[]) =>
      Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;
    return {
      renderer,
      files,
      samples: commits.length,
      commitMs: mean(commits),
      frameMs: mean(frames),
    };
  }, [files, graph, renderer]);

  useEffect(() => {
    window.__spikeFocus = focusBench;
    return () => {
      delete window.__spikeFocus;
    };
  }, [focusBench]);

  useEffect(() => {
    window.__spikeRun = run;
    window.__spikeSet = (next, size) => {
      setRenderer(next);
      setFiles(size);
    };
    return () => {
      delete window.__spikeRun;
      delete window.__spikeSet;
    };
  }, [run]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {RENDERERS.map((name) => (
          <Button
            key={name}
            size="sm"
            variant={name === renderer ? "default" : "outline"}
            onClick={() => setRenderer(name)}
          >
            {name}
          </Button>
        ))}
        <span className="mx-2 h-5 w-px bg-border" />
        {SIZES.map((size) => (
          <Button
            key={size}
            size="sm"
            variant={size === files ? "default" : "outline"}
            onClick={() => setFiles(size)}
          >
            {size / 1000}k
          </Button>
        ))}
        <span className="mx-2 h-5 w-px bg-border" />
        <Button size="sm" variant="secondary" onClick={() => void run()} disabled={running}>
          {running ? "Measuring…" : "Run pan/zoom"}
        </Button>
        <p className="text-muted-foreground text-xs">
          {scene.nodes.length} nodes · {scene.edges.length} edges
        </p>
      </div>

      <div ref={setHost} className="relative">
        {palette === null ? (
          <div className={SURFACE} />
        ) : renderer === "canvas" ? (
          <MapCanvas
            scene={scene}
            palette={palette}
            reducedMotion
            handleRef={handleRef}
            className={SURFACE}
          />
        ) : renderer === "svg" ? (
          <MapSvg scene={scene} palette={palette} handleRef={handleRef} className={SURFACE} />
        ) : (
          <MapSigma scene={scene} palette={palette} handleRef={handleRef} className={SURFACE} />
        )}
      </div>

      {results.length > 0 ? (
        <pre className="overflow-x-auto rounded-lg border border-border bg-surface-1 p-3 text-xs">
          {results.map((result) => JSON.stringify(result)).join("\n")}
        </pre>
      ) : null}
    </div>
  );
}
