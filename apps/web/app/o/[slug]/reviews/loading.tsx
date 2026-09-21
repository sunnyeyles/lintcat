import { PageHeaderSkeleton, TableCardSkeleton } from "@/components/ui";

export default function ReviewsLoading() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeaderSkeleton />
      <TableCardSkeleton rows={10} />
    </div>
  );
}
