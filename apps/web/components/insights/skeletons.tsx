import {
  ChartCardSkeleton,
  SectionHeading,
  StatGridSkeleton,
  TableCardSkeleton,
} from "@/components/ui";

export function TrendsSkeleton() {
  return (
    <>
      <StatGridSkeleton count={4} />
      <ChartCardSkeleton legend />
      <ChartCardSkeleton />
      <ChartCardSkeleton kind="bars" legend height={200} />
    </>
  );
}

export function CostSkeleton() {
  return (
    <>
      <StatGridSkeleton count={4} />
      <ChartCardSkeleton />
      <ChartCardSkeleton height={280} legend />
      <section className="flex flex-col gap-4">
        <SectionHeading title="Cost by repository" />
        <TableCardSkeleton rows={5} columns={5} />
      </section>
    </>
  );
}
