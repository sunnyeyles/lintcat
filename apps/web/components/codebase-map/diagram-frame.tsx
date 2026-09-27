import { Badge, Card, cn } from "@pr-review/design";
import type { ReactNode } from "react";

export function DiagramFrame({
  title,
  badge,
  description,
  footer,
  className,
  children,
}: {
  title: string;
  badge: string;
  description: string;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("gap-0 overflow-hidden py-0 shadow-lg", className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface-2 px-4 py-2.5">
        <span className="font-mono text-caption text-muted-foreground">{title}</span>
        <div className="ml-auto flex items-center gap-3 text-caption text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-map-module" />
            Module
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-map-module-changed" />
            Changed in this PR
          </span>
          <Badge variant="outline" className="hidden sm:inline-flex">
            {badge}
          </Badge>
        </div>
      </div>
      <p className="sr-only">{description}</p>
      <div className="bg-background">{children}</div>
      {footer ? (
        <div className="border-t border-border bg-surface-2 px-4 py-2 text-caption text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}
