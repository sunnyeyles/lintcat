import type { ReactNode } from "react";

import { cn } from "#src/cn";

export type StatDelta = {
  value: string;
  trend?: "up" | "down" | "flat";
  tone?: "neutral" | "ok" | "warn" | "stop";
};

export type StatProps = {
  label: string;
  value: ReactNode;
  delta?: StatDelta;
  hint?: ReactNode;
  children?: ReactNode;
  className?: string;
};

const DELTA_TONE: Record<NonNullable<StatDelta["tone"]>, string> = {
  neutral: "text-slate",
  ok: "text-ok",
  warn: "text-warn",
  stop: "text-stop",
};

const TREND_GLYPH: Record<NonNullable<StatDelta["trend"]>, string> = {
  up: "↑",
  down: "↓",
  flat: "→",
};

export function Stat({ label, value, delta, hint, children, className }: StatProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 border border-rule bg-surface px-3.5 py-3 sm:px-4",
        className,
      )}
    >
      <span className="truncate text-caption text-slate">{label}</span>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-h2 leading-none font-semibold tabular-nums text-ink">
          {value}
        </span>
        {delta ? (
          <span
            className={cn(
              "font-mono text-caption tabular-nums",
              DELTA_TONE[delta.tone ?? "neutral"],
            )}
          >
            {delta.trend ? `${TREND_GLYPH[delta.trend]} ` : ""}
            {delta.value}
          </span>
        ) : null}
      </div>
      {hint ? (
        <span className="font-mono text-caption leading-relaxed text-slate">
          {hint}
        </span>
      ) : null}
      {children ? <div className="mt-2 min-w-0">{children}</div> : null}
    </div>
  );
}

export function StatGrid({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-px border border-rule bg-rule [&>*]:border-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
