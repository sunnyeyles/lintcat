import {
  Badge,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
} from "@pr-review/design";
import type { ReactNode } from "react";

type StatDelta = {
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

const TREND_GLYPH: Record<NonNullable<StatDelta["trend"]>, string> = {
  up: "↑",
  down: "↓",
  flat: "→",
};

export function Stat({ label, value, delta, hint, children, className }: StatProps) {
  return (
    <Card className={cn("gap-0 py-4", className)}>
      <CardHeader className="gap-1 px-4">
        <CardDescription className="truncate">{label}</CardDescription>
        <CardTitle className="font-mono text-2xl leading-none font-semibold tabular-nums">
          {value}
        </CardTitle>
        {delta ? (
          <CardAction>
            <Badge
              variant={delta.tone === "stop" ? "destructive" : "secondary"}
              className="tabular-nums"
            >
              {delta.trend ? `${TREND_GLYPH[delta.trend]} ` : ""}
              {delta.value}
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      {hint || children ? (
        <CardContent className="px-4 pt-2">
          {hint ? (
            <p className="text-muted-foreground text-xs leading-relaxed">{hint}</p>
          ) : null}
          {children ? <div className="mt-2 min-w-0">{children}</div> : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

export function StatGrid({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
