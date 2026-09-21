import type { MapHandle } from "@/components/codebase-map/view";

export interface BenchResult {
  renderer: string;
  files: number;
  nodes: number;
  edges: number;
  frames: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  worstMs: number;
  fps: number;
}

const WARMUP = 20;
const TAU = Math.PI * 2;

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function quantile(sorted: readonly number[], q: number): number {
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[at] ?? 0;
}

/** Drives a scripted pan and zoom and times the gap between painted frames. */
export async function runPanZoom(
  handle: MapHandle,
  meta: { renderer: string; files: number; nodes: number; edges: number },
  frames = 180,
): Promise<BenchResult> {
  const base = handle.getView();
  const samples: number[] = [];
  let previous = await nextFrame();

  for (let i = 0; i < frames + WARMUP; i += 1) {
    const t = (i / frames) * TAU;
    handle.setView({
      x: base.x + Math.sin(t) * 320,
      y: base.y + Math.cos(t) * 220,
      scale: base.scale * (1.6 + Math.sin(t * 2) * 0.8),
    });
    const now = await nextFrame();
    if (i >= WARMUP) samples.push(now - previous);
    previous = now;
  }

  handle.setView(base);
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
  const round = (value: number) => Math.round(value * 10) / 10;

  return {
    ...meta,
    frames: samples.length,
    meanMs: round(mean),
    p50Ms: round(quantile(sorted, 0.5)),
    p95Ms: round(quantile(sorted, 0.95)),
    worstMs: round(sorted[sorted.length - 1] ?? 0),
    fps: round(1000 / Math.max(0.001, mean)),
  };
}
