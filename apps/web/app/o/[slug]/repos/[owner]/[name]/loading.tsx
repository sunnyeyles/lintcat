import {
  PageHeaderSkeleton,
  StatGridSkeleton,
  TableCardSkeleton,
} from "@/components/ui";

export default function RepoDetailLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <StatGridSkeleton className="mt-8" count={6} />
      <div className="mt-12">
        <TableCardSkeleton rows={8} />
      </div>
    </>
  );
}
