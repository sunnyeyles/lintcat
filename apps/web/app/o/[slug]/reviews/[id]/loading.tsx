import { Card, CardContent, Skeleton } from "@pr-review/design";

import { PageHeader } from "@/components/shell";
import { InlineSkeleton, SectionHeading, TableCardSkeleton } from "@/components/ui";

export default function ReviewDetailLoading() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Review"
        size="record"
        title={<InlineSkeleton className="h-lh w-72 max-w-full" />}
        description={<InlineSkeleton className="h-lh w-96 max-w-full" />}
        actions={<Skeleton className="h-control w-40" />}
      />

      <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-8 lg:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-4">
          <SectionHeading title="Summary" />
          <Card className="flex-1 border-l-2 border-l-accent">
            <CardContent className="py-5">
              <div className="max-w-prose space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
              <div className="mt-4 flex gap-1.5 border-t border-border pt-4">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-16" />
              </div>
            </CardContent>
          </Card>
        </section>
        <section className="flex min-w-0 flex-col gap-4">
          <SectionHeading title="Blast radius" action={<Skeleton className="h-5 w-20" />} />
          <Card className="flex-1">
            <CardContent className="flex flex-col gap-4 py-5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-44" />
              <Skeleton className="mt-auto h-3 w-28" />
            </CardContent>
          </Card>
        </section>
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex h-12 items-center gap-5 border-b border-border px-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-10" />
        </div>
        <section className="flex flex-col gap-4">
          <SectionHeading title="Findings" />
          <Skeleton className="h-3 w-64" />
          <TableCardSkeleton rows={6} />
        </section>
      </div>
    </div>
  );
}
