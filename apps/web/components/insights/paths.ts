import { rangeQuery } from "@/components/charts/range";
import { organizationPath, withinOrganization } from "@/lib/paths";

const TABS = [
  { key: "trends", path: "/insights", label: "Trends" },
  { key: "cost", path: "/insights/cost", label: "Tokens & cost" },
] as const;

export type InsightsTabKey = (typeof TABS)[number]["key"];

export type InsightsTab = { href: string; label: string };

export function insightsTabs(slug: string): InsightsTab[] {
  return TABS.map((tab) => ({ href: organizationPath(slug, tab.path), label: tab.label }));
}

// A subdomain's browser path has no `/o/<slug>` prefix, so both sides drop it.
export function isActiveTab(pathname: string, href: string): boolean {
  return withinOrganization(pathname.replace(/(.)\/$/, "$1")) === withinOrganization(href);
}

export function insightsHref(
  slug: string,
  key: InsightsTabKey,
  range?: string | string[] | null,
): string {
  const tab = TABS.find((candidate) => candidate.key === key) ?? TABS[0];
  return organizationPath(slug, tab.path) + rangeQuery(range);
}
