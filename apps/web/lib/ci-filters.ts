import type { CiConclusionFilter } from "@pr-review/db/dashboard";

export type CiFilters = {
  branch?: string;
  workflowId?: number;
  conclusion?: CiConclusionFilter;
};

type SearchParams = Record<string, string | string[] | undefined>;

export const CI_CONCLUSIONS: readonly { value: CiConclusionFilter; label: string }[] = [
  { value: "failure", label: "Failed" },
  { value: "success", label: "Succeeded" },
  { value: "cancelled", label: "Cancelled" },
];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Anything unrecognised is dropped, so a hand-edited URL shows the unfiltered list.
export function parseCiFilters(params: SearchParams): CiFilters {
  const branch = first(params.branch)?.trim();
  const workflow = Number(first(params.workflow));
  const conclusion = CI_CONCLUSIONS.find((c) => c.value === first(params.conclusion));
  return {
    ...(branch ? { branch } : {}),
    ...(Number.isSafeInteger(workflow) && workflow > 0 ? { workflowId: workflow } : {}),
    ...(conclusion ? { conclusion: conclusion.value } : {}),
  };
}

export function ciFiltersQuery(filters: CiFilters): string {
  const query = new URLSearchParams();
  if (filters.branch) query.set("branch", filters.branch);
  if (filters.workflowId !== undefined) query.set("workflow", String(filters.workflowId));
  if (filters.conclusion) query.set("conclusion", filters.conclusion);
  const text = query.toString();
  return text ? `?${text}` : "";
}
