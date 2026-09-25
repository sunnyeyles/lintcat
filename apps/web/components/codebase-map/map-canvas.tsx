"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, type RefObject } from "react";

import { markerParts } from "@/components/codebase-map/markers";
import type { MapPalette } from "@/components/codebase-map/palette";
import type { Scene, SceneNode } from "@/components/codebase-map/scene";
import { clampScale, fitView, type MapHandle, type MapView } from "@/components/codebase-map/view";

const LABEL_SCALE = 0.7;
const LABEL_BUDGET = 160;
const COUNT_SCALE = 0.9;

const HEAT_TOKENS = {
  high: "--severity-high",
  medium: "--severity-medium",
  low: "--severity-low",
} as const;

function heatRing(radius: number, band: number): string {
  const r = radius * (2.2 + band * 0.25);
  return `M ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0 Z`;
}

export interface MapCanvasProps {
  scene: Scene;
  palette: MapPalette;
  reducedMotion: boolean;
  handleRef?: RefObject<MapHandle | null>;
  onSelect?: (node: SceneNode) => void;
  onHover?: (node: SceneNode | null, screenX: number, screenY: number) => void;
  className?: string;
}

function nodeColour(node: SceneNode, palette: MapPalette): string {
  if (node.kind === "group") return palette["--map-structure"];
  switch (node.level) {
    case "focus":
      return palette["--ring"];
    case "changed":
      return palette["--map-module-changed"];
    case "impacted":
      return palette["--map-module-impacted"];
    case "neighbour":
      return node.direction === "dependent"
        ? palette["--map-kind-3"]
        : node.direction === "both"
          ? palette["--foreground"]
          : palette["--map-kind-1"];
    case "context":
      return palette["--map-module"];
    default:
      return palette["--map-edge"];
  }
}

interface Batch {
  path: Path2D;
  mode: "fill" | "stroke";
  width: number;
  colour: string;
}

// Parsing a path string per node per frame is the whole frame budget at 10k, so shapes are cached.
const SHAPES = new Map<string, Path2D>();

function shapeFor(key: string, d: string): Path2D {
  let shape = SHAPES.get(key);
  if (!shape) {
    shape = new Path2D(d);
    SHAPES.set(key, shape);
  }
  return shape;
}

export function MapCanvas({
  scene,
  palette,
  reducedMotion,
  handleRef,
  onSelect,
  onHover,
  className,
}: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<MapView>({ x: 0, y: 0, scale: 1 });
  const sizeRef = useRef({ width: 1, height: 1 });
  const frameRef = useRef(0);
  const sceneRef = useRef(scene);
  const paletteRef = useRef(palette);
  sceneRef.current = scene;
  paletteRef.current = palette;

  const draw = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const { width, height } = sizeRef.current;
    const view = viewRef.current;
    const colours = paletteRef.current;
    const current = sceneRef.current;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);

    const left = -view.x / view.scale;
    const top = -view.y / view.scale;
    const right = left + width / view.scale;
    const bottom = top + height / view.scale;
    const margin = 40 / view.scale;

    // Every edge class is one path, so the whole layer costs three stroke calls.
    const base = new Path2D();
    const dependency = new Path2D();
    const dependent = new Path2D();
    for (const edge of current.edges) {
      const target =
        edge.relation === "base" ? base : edge.relation === "dependency" ? dependency : dependent;
      if (edge.relation === "base") {
        const lo = Math.min(edge.ax, edge.bx);
        const hi = Math.max(edge.ax, edge.bx);
        if (hi < left - margin || lo > right + margin) continue;
        const loY = Math.min(edge.ay, edge.by);
        const hiY = Math.max(edge.ay, edge.by);
        if (hiY < top - margin || loY > bottom + margin) continue;
      }
      target.moveTo(edge.ax, edge.ay);
      target.lineTo(edge.bx, edge.by);
    }

    context.globalAlpha = 0.45;
    context.strokeStyle = colours["--map-edge"];
    context.lineWidth = 0.6 / view.scale;
    context.stroke(base);

    context.globalAlpha = 1;
    context.setLineDash([]);
    context.strokeStyle = colours["--map-kind-1"];
    context.lineWidth = 1.6 / view.scale;
    context.stroke(dependency);

    context.setLineDash([5 / view.scale, 4 / view.scale]);
    context.strokeStyle = colours["--map-kind-3"];
    context.stroke(dependent);
    context.setLineDash([]);

    const batches = new Map<string, Batch>();
    const labels: SceneNode[] = [];
    const counts: SceneNode[] = [];
    const move = new DOMMatrix();
    const minRadius = Math.round((2.4 / view.scale) * 4) / 4;
    for (const node of current.nodes) {
      if (
        node.x + node.radius < left - margin ||
        node.x - node.radius > right + margin ||
        node.y + node.radius < top - margin ||
        node.y - node.radius > bottom + margin
      ) {
        continue;
      }
      const fill = nodeColour(node, colours);
      const stroke =
        node.kind !== "group"
          ? fill
          : node.level === "impacted"
            ? colours["--map-module-impacted"]
            : colours["--map-structure-border"];
      // Zoomed out, a marker at its world radius is sub-pixel and the map turns to mush.
      const radius = Math.max(node.radius, minRadius);
      const shapeKey = `${node.marker}|${node.direction ?? "-"}|${radius}`;
      const parts = markerParts(node.marker, radius, node.direction);
      for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i]!;
        const colour = part.mode === "fill" ? fill : stroke;
        const key = `${shapeKey}|${i}|${colour}`;
        let batch = batches.get(key);
        if (!batch) {
          batch = { path: new Path2D(), mode: part.mode, width: part.width, colour };
          batches.set(key, batch);
        }
        move.e = node.x;
        move.f = node.y;
        batch.path.addPath(shapeFor(`${shapeKey}|${i}`, part.d), move);
      }
      const heat = node.heat;
      if (heat.top !== null) {
        const colour = colours[HEAT_TOKENS[heat.top]];
        const ringKey = `heat|${radius}|${heat.band}`;
        const key = `${ringKey}|${colour}`;
        let batch = batches.get(key);
        if (!batch) {
          batch = { path: new Path2D(), mode: "stroke", width: 0.75 + heat.band * 0.75, colour };
          batches.set(key, batch);
        }
        move.e = node.x;
        move.f = node.y;
        batch.path.addPath(shapeFor(ringKey, heatRing(radius, heat.band)), move);
        if (counts.length < LABEL_BUDGET && view.scale >= COUNT_SCALE) counts.push(node);
      }
      if (
        labels.length < LABEL_BUDGET &&
        (node.level === "focus" ||
          node.level === "neighbour" ||
          (view.scale >= LABEL_SCALE && (node.kind === "group" || node.level === "changed")))
      ) {
        labels.push(node);
      }
    }

    for (const batch of batches.values()) {
      if (batch.mode === "fill") {
        context.fillStyle = batch.colour;
        context.fill(batch.path);
      } else {
        context.strokeStyle = batch.colour;
        context.lineWidth = batch.width / view.scale;
        context.stroke(batch.path);
      }
    }

    if (labels.length > 0 || counts.length > 0) {
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.font = "11px ui-monospace, monospace";
      context.textAlign = "center";
      context.textBaseline = "top";
      context.fillStyle = colours["--map-label"];
      for (const node of labels) {
        const sx = node.x * view.scale + view.x;
        const sy = node.y * view.scale + view.y + node.radius * view.scale + 3;
        if (sx < -60 || sx > width + 60 || sy < -20 || sy > height + 20) continue;
        context.fillText(node.label, sx, sy);
      }

      // The number is the cue a reader without colour gets; the ring only reinforces it.
      context.font = "bold 10px ui-monospace, monospace";
      context.textBaseline = "bottom";
      for (const node of counts) {
        const sx = node.x * view.scale + view.x + node.radius * view.scale + 5;
        const sy = node.y * view.scale + view.y - node.radius * view.scale - 2;
        if (sx < -40 || sx > width + 40 || sy < -20 || sy > height + 20) continue;
        context.fillStyle = colours[HEAT_TOKENS[node.heat.top ?? "low"]];
        context.fillText(String(node.heat.counts.total), sx, sy);
      }
    }
  }, []);

  const schedule = useCallback(() => {
    if (frameRef.current !== 0) return;
    frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const pick = useCallback((screenX: number, screenY: number): SceneNode | null => {
    const view = viewRef.current;
    const wx = (screenX - view.x) / view.scale;
    const wy = (screenY - view.y) / view.scale;
    const slack = 6 / view.scale;
    let best: SceneNode | null = null;
    let bestDistance = Infinity;
    for (const node of sceneRef.current.nodes) {
      const reach = node.radius + slack;
      const dx = node.x - wx;
      const dy = node.y - wy;
      const distance = dx * dx + dy * dy;
      if (distance <= reach * reach && distance < bestDistance) {
        bestDistance = distance;
        best = node;
      }
    }
    return best;
  }, []);

  useImperativeHandle(
    handleRef,
    (): MapHandle => ({
      getView: () => ({ ...viewRef.current }),
      setView: (next) => {
        viewRef.current = { ...next, scale: clampScale(next.scale) };
        schedule();
      },
      fit: () => {
        const { width, height } = sizeRef.current;
        viewRef.current = fitView(sceneRef.current.bounds, width, height);
        schedule();
      },
      fitBounds: (bounds) => {
        const { width, height } = sizeRef.current;
        viewRef.current = fitView(bounds, width, height);
        schedule();
      },
      centreOn: (x, y, scale) => {
        const { width, height } = sizeRef.current;
        const view = viewRef.current;
        const target: MapView = {
          scale: clampScale(scale ?? view.scale),
          x: 0,
          y: 0,
        };
        target.x = width / 2 - x * target.scale;
        target.y = height / 2 - y * target.scale;
        if (reducedMotion) {
          viewRef.current = target;
          schedule();
          return;
        }
        const from = { ...view };
        const start = performance.now();
        const step = () => {
          const t = Math.min(1, (performance.now() - start) / 260);
          const eased = 1 - (1 - t) * (1 - t);
          viewRef.current = {
            x: from.x + (target.x - from.x) * eased,
            y: from.y + (target.y - from.y) * eased,
            scale: from.scale + (target.scale - from.scale) * eased,
          };
          draw();
          if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      },
    }),
    [draw, reducedMotion, schedule],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      sizeRef.current = { width: rect.width, height: rect.height };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      schedule();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [schedule]);

  useEffect(() => {
    schedule();
  }, [scene, palette, schedule]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let moved = false;

    // Capture is a nicety; losing it must never swallow the click that follows.
    const capture = (on: boolean, pointerId: number) => {
      try {
        if (on) canvas.setPointerCapture(pointerId);
        else canvas.releasePointerCapture(pointerId);
      } catch {}
    };

    const local = (event: PointerEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      dragging = true;
      moved = false;
      const point = local(event);
      lastX = point.x;
      lastY = point.y;
      capture(true, event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      const point = local(event);
      if (!dragging) {
        onHover?.(pick(point.x, point.y), event.clientX, event.clientY);
        return;
      }
      const dx = point.x - lastX;
      const dy = point.y - lastY;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;
      lastX = point.x;
      lastY = point.y;
      viewRef.current = {
        ...viewRef.current,
        x: viewRef.current.x + dx,
        y: viewRef.current.y + dy,
      };
      schedule();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      capture(false, event.pointerId);
      if (moved) return;
      const point = local(event);
      const hit = pick(point.x, point.y);
      if (hit) onSelect?.(hit);
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = local(event);
      const view = viewRef.current;
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
      const scale = clampScale(view.scale * factor);
      const ratio = scale / view.scale;
      viewRef.current = {
        scale,
        x: point.x - (point.x - view.x) * ratio,
        y: point.y - (point.y - view.y) * ratio,
      };
      schedule();
    };

    const onLeave = () => onHover?.(null, 0, 0);

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [onHover, onSelect, pick, schedule]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
