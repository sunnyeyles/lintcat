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
  tone?: "ok" | "stop";
};

export type StatProps = {
  label: string;
  value: ReactNode;
  delta?: StatDelta;
  children?: ReactNode;
  className?: string;
};

export function Stat({ label, value, delta, children, className }: StatProps) {
  return (
    <Card className={cn("gap-0 py-4", className)}>
      <CardHeader className="gap-1 px-4">
        <CardDescription className="truncate">{label}</CardDescription>
        <CardTitle className="font-mono text-h1 leading-none font-semibold tabular-nums">
          {value}
        </CardTitle>
        {delta ? (
          <CardAction>
            <Badge
              variant={delta.tone === "stop" ? "destructive" : "secondary"}
              className="tabular-nums"
            >
              {delta.value}
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      {children ? <CardContent className="min-w-0 px-4 pt-4">{children}</CardContent> : null}
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
