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

// Fixed shapes, never random, so server and client markup agree.
const Y_TICKS = [0, 1, 2, 3, 4];
const X_TICKS = [0, 1, 2, 3, 4, 5];
const AREA_TOPS = [72, 60, 66, 48, 54, 40, 46, 30, 42, 36, 50, 38];
const BARS = [
  { label: "w-16", bar: "90%" },
  { label: "w-20", bar: "64%" },
  { label: "w-14", bar: "48%" },
  { label: "w-18", bar: "36%" },
  { label: "w-12", bar: "28%" },
  { label: "w-16", bar: "20%" },
  { label: "w-14", bar: "14%" },
];

function areaPath(tops: readonly number[]): string {
  const step = 100 / (tops.length - 1);
  let d = `M0,${tops[0]}`;
  for (let i = 1; i < tops.length; i++) {
    const x0 = (i - 1) * step;
    const x1 = i * step;
    const mid = (x0 + x1) / 2;
    d += ` C${mid},${tops[i - 1]} ${mid},${tops[i]} ${x1},${tops[i]}`;
  }
  return `${d} L100,100 L0,100 Z`;
}

const AREA_PATH = areaPath(AREA_TOPS);

function XTicksSkeleton({ gutter, width }: { gutter: string; width: string }) {
  return (
    <div className={cn("flex justify-between pt-2", gutter)}>
      {X_TICKS.map((i) => (
        <Skeleton key={i} className={cn("h-3", width)} />
      ))}
    </div>
  );
}

// Gutter widths match the real YAxis widths, so the plot lands where the chart will.
function AreaPlotSkeleton() {
  return (
    <>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-x-0 inset-y-1.5 flex flex-col justify-between">
          {Y_TICKS.map((i) => (
            <div key={i} className="flex h-0 items-center gap-2">
              <div className="flex w-[30px] justify-end">
                <Skeleton className="h-3 w-5" />
              </div>
              <div data-slot="chart-skeleton-gridline" className="bg-border h-px flex-1" />
            </div>
          ))}
        </div>
        <div className="absolute inset-y-1.5 right-0 left-[38px]">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="fill-accent size-full animate-pulse"
          >
            <path d={AREA_PATH} />
          </svg>
        </div>
      </div>
      <XTicksSkeleton gutter="pl-[38px]" width="w-10" />
    </>
  );
}

function BarPlotSkeleton() {
  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col justify-around">
        <div className="absolute inset-y-0 right-0 left-[116px] flex justify-between">
          {Y_TICKS.map((i) => (
            <div key={i} data-slot="chart-skeleton-gridline" className="bg-border w-px" />
          ))}
        </div>
        {BARS.map(({ label, bar }) => (
          <div key={bar} data-slot="chart-skeleton-bar" className="relative flex items-center gap-2">
            <div className="flex w-[108px] justify-end">
              <Skeleton className={cn("h-3", label)} />
            </div>
            <div className="flex-1">
              {/* The card backing keeps gridlines from showing through the translucent bar. */}
              <div className="bg-card rounded-r-md" style={{ width: bar }}>
                <Skeleton className="h-4 rounded-l-none" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <XTicksSkeleton gutter="pl-[116px]" width="w-5" />
    </>
  );
}

function LegendSkeleton() {
  return (
    <div data-slot="chart-skeleton-legend" className="flex justify-center gap-4 pt-3">
      {[0, 1, 2].map((i) => (
        <span key={i} className="flex items-center gap-1.5">
          <Skeleton className="size-2.5 rounded-[2px]" />
          <Skeleton className="h-3 w-12" />
        </span>
      ))}
    </div>
  );
}

// Mirrors ChartFrame: title, description, plot, caption, collapsed data table.
export function ChartCardSkeleton({
  height = 260,
  kind = "area",
  legend = false,
  className,
}: {
  height?: number;
  kind?: "area" | "bars";
  legend?: boolean;
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
        <div aria-hidden className="flex flex-col" style={{ height }}>
          {kind === "bars" ? <BarPlotSkeleton /> : <AreaPlotSkeleton />}
          {legend ? <LegendSkeleton /> : null}
        </div>
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
