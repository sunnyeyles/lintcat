"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  type ChartConfig,
  ChartContainer,
  cn,
} from "@pr-review/design";
import { type ReactElement, type ReactNode, useId } from "react";

export type ChartFrameProps = {
  title: string;
  description?: string;
  /** Read aloud in place of the plot, and printed under it. */
  summary: string;
  config: ChartConfig;
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
  config,
  table,
  footer,
  height = 260,
  className,
  children,
}: ChartFrameProps) {
  const captionId = useId();
  return (
    <Card className={cn("flex min-w-0 flex-col", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-1 flex-col">
        <figure className="m-0 min-w-0">
          <div
            role="img"
            aria-label={title}
            aria-describedby={captionId}
            style={{ height }}
          >
            <ChartContainer config={config} className="aspect-auto h-full w-full">
              {children}
            </ChartContainer>
          </div>
          <figcaption
            id={captionId}
            className="text-muted-foreground mt-3 text-xs leading-relaxed"
          >
            {summary}
          </figcaption>
        </figure>
        {table}
        {footer ? (
          <div className="text-muted-foreground mt-3 text-xs leading-relaxed">
            {footer}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
