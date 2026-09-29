import type { ReactNode } from "react";

import { InsightsScope, insightsTabs } from "@/components/insights";
import { PageHeader } from "@/components/shell";

export default async function InsightsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <>
      <PageHeader
        eyebrow="Insights"
        title="Insights"
        description="What reviews found, and what they cost at list prices."
        className="border-b-0 pb-0"
      />
      <div className="mt-6">
        <InsightsScope tabs={insightsTabs(slug)}>{children}</InsightsScope>
      </div>
    </>
  );
}
