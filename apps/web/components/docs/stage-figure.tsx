"use client";

import { useEffect, useRef } from "react";

import { colourMode, paint, replay, type Drawing } from "./pixel-canvas";

export type StageFigureProps = { id: string; n: number; title: string };

// One drawn stage from docs/explainer, drawn live in the page's colours. Reduced motion shows it finished.
export function StageFigure({ id, n, title }: StageFigureProps) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const root = document.documentElement;
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    let drawing: Drawing | undefined;
    let grid = new Uint8Array(0);
    let palette: string[] = [];
    let laid = 0, frame = 0, origin = 0, raf = 0, visible = false, gone = false;

    const show = (count: number, repaint = false) => {
      if (!drawing) return;
      if (count < laid) {
        grid.fill(0);
        laid = 0;
      }
      if (count === laid && !repaint) return;
      replay(grid, drawing.ops(), laid, count);
      laid = count;
      paint(ctx, grid, drawing.G, drawing.H, palette, el.width, el.height);
    };
    // Paper is whatever the page paints behind the canvas, so the two cannot drift apart.
    const recolour = () => {
      if (!drawing) return;
      palette = [...drawing.palettes[colourMode(root)]];
      palette[0] = getComputedStyle(el).backgroundColor;
      show(laid, true);
    };
    const tick = (now: number) => {
      if (!drawing) return;
      frame = Math.floor(((now - origin) / 1000) * drawing.fps) % drawing.frames;
      show(drawing.at(frame));
      raf = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(raf);
      if (!drawing) return;
      if (still.matches) return show(drawing.at(drawing.frames - 1));
      if (!visible) return;
      origin = performance.now() - (frame / drawing.fps) * 1000;
      raf = requestAnimationFrame(tick);
    };

    const sizes = new ResizeObserver(([entry]) => {
      const box = entry.devicePixelContentBoxSize?.[0];
      const width = box?.inlineSize ?? Math.round(entry.contentRect.width * devicePixelRatio);
      const height = box?.blockSize ?? Math.round(entry.contentRect.height * devicePixelRatio);
      if (width === el.width && height === el.height) return;
      el.width = width;
      el.height = height;
      show(laid, true);
    });
    try {
      sizes.observe(el, { box: "device-pixel-content-box" });
    } catch {
      sizes.observe(el);
    }
    const seen = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    seen.observe(el);
    const modes = new MutationObserver(recolour);
    modes.observe(root, { attributes: true, attributeFilter: ["data-color-mode", "data-light-theme", "data-dark-theme"] });
    scheme.addEventListener("change", recolour);
    still.addEventListener("change", sync);

    void import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `/explainer/${id}.js`).then((m: { default: Drawing }) => {
      if (gone) return;
      drawing = m.default;
      grid = new Uint8Array(drawing.G * drawing.H);
      recolour();
      sync();
    });

    return () => {
      gone = true;
      cancelAnimationFrame(raf);
      sizes.disconnect();
      seen.disconnect();
      modes.disconnect();
      scheme.removeEventListener("change", recolour);
      still.removeEventListener("change", sync);
    };
  }, [id]);

  return (
    <figure className="flex flex-col gap-2">
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Stage ${n}: ${title}, drawn step by step`}
        className="block aspect-video w-full rounded-sm border border-border bg-background [image-rendering:pixelated]"
      />
      <figcaption className="text-label text-muted-foreground">
        <span className="eyebrow">Stage {n}</span>
        <span className="ml-2">{title}</span>
      </figcaption>
    </figure>
  );
}
