"use client";

import { useEffect, useState } from "react";

const TOKENS = [
  "--background",
  "--foreground",
  "--muted-foreground",
  "--border",
  "--ring",
  "--map-module",
  "--map-module-changed",
  "--map-module-impacted",
  "--map-structure",
  "--map-structure-border",
  "--map-label",
  "--map-edge",
  "--map-kind-1",
  "--map-kind-3",
  "--severity-low",
  "--severity-medium",
  "--severity-high",
] as const;

type MapToken = (typeof TOKENS)[number];
export type MapPalette = Record<MapToken, string>;

function readPalette(element: Element): MapPalette {
  const style = getComputedStyle(element);
  const palette = {} as MapPalette;
  for (const token of TOKENS) {
    palette[token] = style.getPropertyValue(token).trim() || "gray";
  }
  return palette;
}

/** Re-read on a colour mode or theme change, because canvas cannot inherit CSS variables. */
export function usePalette(element: Element | null): MapPalette | null {
  const [palette, setPalette] = useState<MapPalette | null>(null);

  useEffect(() => {
    if (!element) return;
    const refresh = () => setPalette(readPalette(element));
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme", "data-color-mode"],
    });
    return () => observer.disconnect();
  }, [element]);

  return palette;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}
