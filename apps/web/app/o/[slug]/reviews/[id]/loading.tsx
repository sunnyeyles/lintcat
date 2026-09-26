import { Card, CardContent, Skeleton } from "@pr-review/design";

import { PageHeader } from "@/components/shell";
import { TableCardSkeleton } from "@/components/ui";

export default function ReviewDetailLoading() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Review"
        size="record"
        title={<Skeleton as="span" className="h-lh w-72 max-w-full" />}
        description={<Skeleton as="span" className="h-lh w-96 max-w-full" />}
        actions={<Skeleton className="h-control w-40" />}
      />

      <Card className="border-l-2 border-l-accent">
        <CardContent className="py-5">
          <Skeleton className="mb-2.5 h-4 w-20" />
          <div className="max-w-prose space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </CardContent>
      </Card>

      <TableCardSkeleton rows={6} />
    </div>
  );
}
