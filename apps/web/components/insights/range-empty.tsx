import type { Range } from "@pr-review/db/dashboard";

import { RANGE_PHRASE } from "@/components/charts/range";
import { EmptyNotice } from "@/components/overview/empty-notice";

import { insightsHref, type InsightsTabKey } from "./paths";

export type RangeEmptyProps = {
  slug: string;
  tab: InsightsTabKey;
  range: Range;
  title: string;
  installHref: string;
};

export function RangeEmpty({ slug, tab, range, title, installHref }: RangeEmptyProps) {
  return (
    <EmptyNotice
      title={title}
      sentence={`No reviews ran in ${RANGE_PHRASE[range]}.`}
      action={
        range === "90d"
          ? { label: "Connect a repository", href: installHref }
          : { label: "Show 90 days", href: insightsHref(slug, tab, "90d") }
      }
    />
  );
}
