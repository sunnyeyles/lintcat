import {
  PageHeaderSkeleton,
  StatGridSkeleton,
  TableCardSkeleton,
} from "@/components/ui";

export default function OrganizationLoading() {
  return (
    <>
      <PageHeaderSkeleton actions />
      <StatGridSkeleton className="mt-8" count={5} />
      <div className="mt-12">
        <TableCardSkeleton rows={8} />
      </div>
    </>
  );
}
