import { PageHeaderSkeleton, TableCardSkeleton } from "@/components/ui";

export default function ReposLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <div className="mt-8">
        <TableCardSkeleton rows={8} />
      </div>
    </>
  );
}
