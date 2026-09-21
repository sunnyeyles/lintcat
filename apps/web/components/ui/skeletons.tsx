import { Card, CardContent, CardHeader, cn, Skeleton } from "@pr-review/design";

import { StatGrid } from "./stat";

export function PageHeaderSkeleton({ actions = false }: { actions?: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b pb-5">
      <div className="min-w-0 flex-1 basis-[18rem]">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2.5 h-8 w-64" />
        <Skeleton className="mt-3 h-4 w-full max-w-prose" />
      </div>
      {actions ? <Skeleton className="h-8 w-36 shrink-0" /> : null}
    </div>
  );
}

// A span, because the header's description places it inside a <p>.
export function InlineSkeleton({ className }: { className?: string }) {
  return (
    <span
      className={cn("bg-accent inline-block animate-pulse rounded-md align-middle", className)}
    />
  );
}

export function StatCardSkeleton() {
  return (
    <Card className="gap-0 py-4">
      <CardHeader className="gap-1 px-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-6 w-16" />
      </CardHeader>
      <CardContent className="px-4 pt-2">
        <Skeleton className="h-3 w-28" />
      </CardContent>
    </Card>
  );
}

export function StatCardsSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </>
  );
}

export function StatGridSkeleton({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <StatGrid className={className}>
      <StatCardsSkeleton count={count} />
    </StatGrid>
  );
}

export function TableCardSkeleton({
  rows = 6,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <Card className={cn("py-0", className)}>
      <div className="px-4">
        <div className="border-border flex h-10 items-center gap-4 border-b">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="ml-auto h-3 w-16" />
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="border-border flex h-12 items-center gap-4 border-b last:border-b-0"
          >
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ChartCardSkeleton({
  height = 260,
  className,
}: {
  height?: number;
  className?: string;
}) {
  return (
    <Card className={cn("flex min-w-0 flex-col", className)}>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-1.5 h-3 w-56" />
      </CardHeader>
      <CardContent className="flex min-w-0 flex-1 flex-col">
        <Skeleton className="w-full" style={{ height }} />
        <Skeleton className="mt-3 h-3 w-3/4" />
      </CardContent>
    </Card>
  );
}
