"use client";

import type { Finding } from "@pr-review/db";
import { useId, useMemo, useState } from "react";

import {
  Button,
  EmptyState,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SeverityBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import type { Severity } from "@/lib/data";

import { ConfidenceMeter } from "./confidence-meter";
import { FilePath } from "./file-path";
import { FindingSheet } from "./finding-sheet";
import { SEVERITIES, categoriesOf, sortFindings } from "./sort";

const ALL = "all";

export function FindingsTable({ findings }: { findings: readonly Finding[] }) {
  const severityId = useId();
  const categoryId = useId();
  const [severity, setSeverity] = useState<Severity | typeof ALL>(ALL);
  const [category, setCategory] = useState<string>(ALL);
  const [selected, setSelected] = useState<Finding | null>(null);

  const sorted = useMemo(() => sortFindings(findings), [findings]);
  const categories = useMemo(() => categoriesOf(findings), [findings]);
  const rows = useMemo(
    () =>
      sorted.filter(
        (f) =>
          (severity === ALL || f.severity === severity) &&
          (category === ALL || f.category === category),
      ),
    [sorted, severity, category],
  );

  const filtered = severity !== ALL || category !== ALL;
  const reset = () => {
    setSeverity(ALL);
    setCategory(ALL);
  };

  return (
    <section aria-labelledby="findings-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <h2 id="findings-heading" className="eyebrow font-mono">
          Findings
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={severityId}>Severity</Label>
            <Select
              value={severity}
              onValueChange={(v) => setSeverity(v as Severity | typeof ALL)}
            >
              <SelectTrigger id={severityId} className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All severities</SelectItem>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={categoryId}>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id={categoryId} className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {filtered ? (
            <Button variant="ghost" size="sm" onClick={reset}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <p aria-live="polite" className="mb-3 font-mono text-[0.68rem] text-slate-dim">
        {rows.length} of {sorted.length} shown · sorted by severity, then confidence
      </p>

      {rows.length === 0 ? (
        <EmptyState
          title="No findings match these filters"
          description="Widen the severity or category filter to see the rest of this review."
          action={
            <Button variant="outline" size="sm" onClick={reset}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="rounded-[3px] border border-rule bg-surface px-4 py-3 sm:px-5">
          <Table className="min-w-[52rem] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[7rem]">Severity</TableHead>
                <TableHead className="w-[24%]">File</TableHead>
                <TableHead className="w-[9rem]">Category</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="w-[8.5rem]">Confidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((finding) => (
                <TableRow
                  key={finding.id}
                  onClick={() => setSelected(finding)}
                  className="cursor-pointer has-[:focus-visible]:bg-surface-2"
                >
                  <TableCell>
                    <SeverityBadge severity={finding.severity} />
                  </TableCell>
                  <TableCell className="min-w-0">
                    <FilePath
                      file={finding.file}
                      line={finding.line}
                      className="text-[0.74rem]"
                    />
                  </TableCell>
                  <TableCell className="text-slate-dim">{finding.category}</TableCell>
                  <TableCell>
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      aria-label={`${finding.severity} severity: ${finding.title} at ${finding.file}${
                        finding.line == null ? "" : `:${finding.line}`
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(finding);
                      }}
                      className="text-left leading-snug text-ink underline-offset-2 outline-none hover:text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                    >
                      {finding.title}
                    </button>
                  </TableCell>
                  <TableCell>
                    <ConfidenceMeter value={finding.confidence} className="w-full" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <FindingSheet finding={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
