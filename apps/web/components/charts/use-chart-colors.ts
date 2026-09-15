"use client";

import { useEffect, useLayoutEffect, useState } from "react";

export const CHART_TOKENS = {
  agentSecurity: "--agent-security",
  agentCorrectness: "--agent-correctness",
  agentPerformance: "--agent-performance",
  agentTests: "--agent-tests",
  agentDocs: "--agent-docs",
  sevLow: "--sev-low",
  sevMedium: "--sev-medium",
  sevHigh: "--sev-high",
  accent: "--accent",
  ink: "--ink",
  slate: "--slate",
  slateDim: "--slate-dim",
  rule: "--rule",
  ruleSoft: "--rule-soft",
  surface: "--surface",
  surface2: "--surface-2",
} as const;

export type ChartColorKey = keyof typeof CHART_TOKENS;
export type ChartColors = Record<ChartColorKey, string>;

// Light values from globals.css, used for SSR and if getComputedStyle yields nothing.
const FALLBACK_COLORS: ChartColors = {
  agentSecurity: "#b4133f",
  agentCorrectness: "#7e5a12",
  agentPerformance: "#2f4ba0",
  agentTests: "#6b2c87",
  agentDocs: "#12666a",
  sevLow: "#5a6878",
  sevMedium: "#8a6010",
  sevHigh: "#b4133f",
  accent: "#b4133f",
  ink: "#10151c",
  slate: "#5a6878",
  slateDim: "#8c99a7",
  rule: "#cfd8e1",
  ruleSoft: "#e1e7ed",
  surface: "#ffffff",
  surface2: "#eaeef2",
};

const KEYS = Object.keys(CHART_TOKENS) as ChartColorKey[];

function readChartColors(): ChartColors {
  if (typeof document === "undefined") return FALLBACK_COLORS;
  const computed = getComputedStyle(document.documentElement);
  const next = {} as ChartColors;
  for (const key of KEYS) {
    next[key] =
      computed.getPropertyValue(CHART_TOKENS[key]).trim() || FALLBACK_COLORS[key];
  }
  return next;
}

function sameColors(a: ChartColors, b: ChartColors): boolean {
  return KEYS.every((key) => a[key] === b[key]);
}

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

// Recharts needs concrete colour strings, so resolve the tokens and re-resolve on theme flips.
export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(FALLBACK_COLORS);

  useIsomorphicLayoutEffect(() => {
    let frame = 0;
    const sync = () => {
      const next = readChartColors();
      setColors((prev) => (sameColors(prev, next) ? prev : next));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };

    sync();

    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class", "style"],
    });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", schedule);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      media.removeEventListener("change", schedule);
    };
  }, []);

  return colors;
}
