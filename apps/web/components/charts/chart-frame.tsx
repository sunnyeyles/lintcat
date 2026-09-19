"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
} from "@pr-review/design";
import { type ReactElement, type ReactNode, useId } from "react";
import { ResponsiveContainer } from "recharts";

import { ChartLegend, type ChartLegendItem } from "./chart-legend";

export type ChartFrameProps = {
  title: string;
  description?: string;
  /** Read aloud in place of the plot, and printed under it. */
  summary: string;
  legend?: readonly ChartLegendItem[];
  table?: ReactNode;
  footer?: ReactNode;
  height?: number;
  className?: string;
  children: ReactElement;
};

export function ChartFrame({
  title,
  description,
  summary,
  legend,
  table,
  footer,
  height = 260,
  className,
  children,
}: ChartFrameProps) {
  const captionId = useId();
  return (
    <Card className={cn("flex min-w-0 flex-col", className)}>
      <CardHeader className="block">
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-1 flex-col">
        {legend && legend.length > 0 ? (
          <div className="mb-3">
            <ChartLegend items={legend} />
          </div>
        ) : null}
        <figure className="m-0 min-w-0">
          <div
            role="img"
            aria-label={title}
            aria-describedby={captionId}
            className="w-full min-w-0"
            style={{ height }}
          >
            <ResponsiveContainer width="100%" height="100%">
              {children}
            </ResponsiveContainer>
          </div>
          <figcaption
            id={captionId}
            className="mt-3 font-mono text-caption leading-relaxed text-slate"
          >
            {summary}
          </figcaption>
        </figure>
        {table}
        {footer ? (
          <div className="mt-3 font-mono text-caption leading-relaxed text-slate">
            {footer}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
