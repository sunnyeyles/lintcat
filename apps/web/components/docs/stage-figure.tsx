"use client";

import { useEffect, useRef } from "react";

export type StageFigureProps = { id: string; n: number; title: string };

// One drawn stage from docs/explainer, served from public/explainer. Reduced motion keeps the poster.
export function StageFigure({ id, n, title }: StageFigureProps) {
  const video = useRef<HTMLVideoElement>(null);
  const base = `/explainer/${id}`;

  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      const el = video.current;
      if (!el) return;
      if (mq.matches) el.pause();
      else void el.play().catch(() => undefined);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return (
    <figure className="flex flex-col gap-2">
      <video
        ref={video}
        className="block w-full rounded-sm border border-border bg-card"
        src={`${base}.mp4`}
        poster={`${base}.png`}
        width={960}
        height={540}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        aria-label={`Stage ${n}: ${title}, drawn step by step`}
      />
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-label text-muted-foreground">
        <span>
          <span className="eyebrow">Stage {n}</span>
          <span className="ml-2">{title}</span>
        </span>
        <a href={`${base}.html`} target="_blank" rel="noreferrer" className="text-link">
          Open the drawing
        </a>
      </figcaption>
    </figure>
  );
}
