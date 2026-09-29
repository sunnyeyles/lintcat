import type { ReviewListOptions, Severity } from "@pr-review/db/dashboard";

export type ReviewFilters = {
  repo?: { owner: string; name: string };
  minSeverity?: Severity;
  hasFindings: boolean;
};

type SearchParams = Record<string, string | string[] | undefined>;

const SEVERITY_VALUES: readonly Severity[] = ["low", "medium", "high"];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Anything unrecognised is dropped, so a hand-edited URL shows the unfiltered list.
export function parseReviewFilters(params: SearchParams): ReviewFilters {
  const [owner, name, ...rest] = first(params.repo)?.split("/") ?? [];
  const severity = first(params.severity);
  return {
    ...(owner && name && rest.length === 0 ? { repo: { owner, name } } : {}),
    ...(SEVERITY_VALUES.find((s) => s === severity)
      ? { minSeverity: severity as Severity }
      : {}),
    hasFindings: first(params.findings) === "1",
  };
}

export function reviewFiltersQuery(filters: ReviewFilters): string {
  const query = new URLSearchParams();
  if (filters.repo) query.set("repo", `${filters.repo.owner}/${filters.repo.name}`);
  if (filters.minSeverity) query.set("severity", filters.minSeverity);
  if (filters.hasFindings) query.set("findings", "1");
  const text = query.toString();
  return text ? `?${text}` : "";
}

export function isFiltered(filters: ReviewFilters): boolean {
  return reviewFiltersQuery(filters) !== "";
}

export function reviewListOptions(filters: ReviewFilters): ReviewListOptions {
  return {
    ...(filters.repo ? { repo: filters.repo } : {}),
    ...(filters.minSeverity ? { minSeverity: filters.minSeverity } : {}),
    ...(filters.hasFindings ? { hasFindings: true } : {}),
  };
}
