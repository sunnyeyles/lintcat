import { permanentRedirect } from "next/navigation";

import { insightsHref } from "@/components/insights/paths";

export default async function AnalyticsRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  permanentRedirect(insightsHref(slug, "trends", query.range));
}
