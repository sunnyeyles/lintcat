"use client";

import {
  Button,
  cn,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@pr-review/design";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  use,
  useId,
  useOptimistic,
  useTransition,
} from "react";

import type { Severity } from "@pr-review/db/dashboard";
import { isFiltered, type ReviewFilters, reviewFiltersQuery } from "@/lib/review-filters";

const ANY = "any";

const SEVERITY_OPTIONS: { value: Severity; label: string }[] = [
  { value: "high", label: "High only" },
  { value: "medium", label: "Medium and up" },
  { value: "low", label: "Low and up" },
];

type FilterContext = { filters: ReviewFilters; apply: (next: ReviewFilters) => void };

const FiltersContext = createContext<FilterContext | null>(null);

function useFilters(): FilterContext {
  const context = use(FiltersContext);
  if (!context) throw new Error("Filter controls must sit inside ReviewFilterScope");
  return context;
}

export type RepoOption = { owner: string; name: string };

export function RepoFilterSelect({ repos }: { repos: readonly RepoOption[] }) {
  const { filters, apply } = useFilters();
  const id = useId();
  const current = filters.repo ? `${filters.repo.owner}/${filters.repo.name}` : ANY;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>Repository</Label>
      <Select
        value={current}
        onValueChange={(value) => {
          const [owner, name] = value.split("/");
          const { repo: _repo, ...rest } = filters;
          apply(owner && name ? { ...rest, repo: { owner, name } } : rest);
        }}
      >
        <SelectTrigger id={id} className="w-60">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={ANY}>All repositories</SelectItem>
            {repos.map((repo) => {
              const value = `${repo.owner}/${repo.name}`;
              return (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              );
            })}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

function SeverityFilterSelect() {
  const { filters, apply } = useFilters();
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>Minimum severity</Label>
      <Select
        value={filters.minSeverity ?? ANY}
        onValueChange={(value) => {
          const { minSeverity: _minSeverity, ...rest } = filters;
          const picked = SEVERITY_OPTIONS.find((option) => option.value === value);
          apply(picked ? { ...rest, minSeverity: picked.value } : rest);
        }}
      >
        <SelectTrigger id={id} className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={ANY}>Any severity</SelectItem>
            {SEVERITY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

function HasFindingsSwitch() {
  const { filters, apply } = useFilters();
  const id = useId();
  return (
    <div className="flex h-control items-center gap-2 self-end">
      <Switch
        id={id}
        checked={filters.hasFindings}
        onCheckedChange={(hasFindings) => apply({ ...filters, hasFindings })}
      />
      <Label htmlFor={id}>Has findings</Label>
    </div>
  );
}

export type ReviewFilterScopeProps = {
  filters: ReviewFilters;
  repoControl: ReactNode;
  children: ReactNode;
};

// Results stay on screen, dimmed, while the server streams the newly filtered list.
export function ReviewFilterScope({ filters, repoControl, children }: ReviewFilterScopeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(filters);

  const apply = (next: ReviewFilters) =>
    startTransition(() => {
      setShown(next);
      router.replace(`${pathname}${reviewFiltersQuery(next)}`, { scroll: false });
    });

  return (
    <FiltersContext value={{ filters: shown, apply }}>
      <div className="flex min-w-0 flex-col gap-5">
        <div
          role="group"
          aria-label="Filter reviews"
          className="flex flex-wrap items-end gap-x-4 gap-y-3"
        >
          {repoControl}
          <SeverityFilterSelect />
          <HasFindingsSwitch />
          {isFiltered(shown) ? (
            <Button
              variant="ghost"
              size="sm"
              className="self-end"
              onClick={() => apply({ hasFindings: false })}
            >
              Clear
            </Button>
          ) : null}
          <span aria-live="polite" className="sr-only">
            {pending ? "Loading filtered reviews" : ""}
          </span>
        </div>
        <div
          aria-busy={pending}
          className={cn(
            "min-w-0 transition-opacity duration-150",
            pending && "opacity-60",
          )}
        >
          {children}
        </div>
      </div>
    </FiltersContext>
  );
}
