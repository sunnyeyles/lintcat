import {
  Card,
  CardContent,
  CardHeader,
  cn,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pr-review/design";

import { StatGrid } from "./stat";

// A span, because the header's description places it inside a <p>.
export function InlineSkeleton({ className }: { className?: string }) {
  return (
    <span
      className={cn("bg-accent inline-block animate-pulse rounded-md align-middle", className)}
    />
  );
}

type StatShape = {
  hint?: boolean;
  sparkline?: boolean;
};

// Each bar takes its height from the line box of the type it stands in for (h-lh).
function StatCardSkeleton({ hint = true, sparkline = false }: StatShape) {
  return (
    <Card className="gap-0 py-4">
      <CardHeader className="gap-1 px-4">
        <div className="text-sm">
          <Skeleton className="h-lh w-24" />
        </div>
        <div className="text-h1 leading-none">
          <Skeleton className="h-lh w-16" />
        </div>
      </CardHeader>
      {hint || sparkline ? (
        <CardContent className="px-4 pt-2">
          {hint ? (
            <div className="text-sm">
              <Skeleton className="h-lh w-28" />
            </div>
          ) : null}
          {sparkline ? (
            <Skeleton className="mt-2 h-[26px] w-full max-w-[120px]" />
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

// `sparkline` applies to the first card only, as in the overview's leading stat.
export function StatCardsSkeleton({
  count,
  hint,
  sparkline,
}: StatShape & { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <StatCardSkeleton key={i} hint={hint} sparkline={i === 0 && sparkline} />
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
  columns = 5,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <Card className={cn("py-0", className)}>
      <Table>
        <TableHeader>
          <TableRow>
            {Array.from({ length: columns }, (_, i) => (
              <TableHead key={i}>
                <Skeleton className="h-3 w-16" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }, (_, r) => (
            <TableRow key={r}>
              {Array.from({ length: columns }, (_, c) => (
                <TableCell key={c}>
                  <Skeleton className={cn("h-4", c === 0 ? "w-40" : "w-14")} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

// Mirrors ChartFrame: title, description, plot, caption, collapsed data table.
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
        <div className="leading-none">
          <Skeleton className="h-lh w-40" />
        </div>
        <div className="text-sm">
          <Skeleton className="h-lh w-56" />
        </div>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-1 flex-col">
        <Skeleton className="w-full" style={{ height }} />
        <div className="mt-3 text-xs leading-relaxed">
          <Skeleton className="h-lh w-3/4" />
        </div>
        <div className="mt-3 border-t pt-2 text-xs">
          <Skeleton className="h-lh w-32" />
        </div>
      </CardContent>
    </Card>
  );
}
