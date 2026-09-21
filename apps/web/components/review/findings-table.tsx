"use client";

import type { Finding } from "@pr-review/db";
import {
  Button,
  Card,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pr-review/design";
import { useId, useMemo, useState } from "react";

import { AGENT_LABELS, SeverityBadge } from "@/components/ui";
import type { Severity } from "@pr-review/db/dashboard";

import { ConfidenceMeter } from "./confidence-meter";
import { FilePath } from "./file-path";
import { FindingSheet } from "./finding-sheet";
import { FINDINGS_ANCHOR, useFindingsFocus } from "./findings-focus";
import {
  type AgentFilterKey,
  OTHER_AGENT,
  SEVERITIES,
  agentKeyOf,
  agentKeysOf,
  sortFindings,
} from "./sort";

const ALL = "all";

function agentLabel(key: AgentFilterKey): string {
  return key === OTHER_AGENT ? "other" : AGENT_LABELS[key];
}

export function FindingsTable({ findings }: { findings: readonly Finding[] }) {
  const severityId = useId();
  const agentId = useId();
  const [severity, setSeverity] = useState<Severity | typeof ALL>(ALL);
  const [agent, setAgent] = useState<AgentFilterKey | typeof ALL>(ALL);
  const [selected, setSelected] = useState<Finding | null>(null);
  const { file, clearFile } = useFindingsFocus();

  const sorted = useMemo(() => sortFindings(findings), [findings]);
  const agents = useMemo(() => agentKeysOf(findings), [findings]);
  const rows = useMemo(
    () =>
      sorted.filter(
        (f) =>
          (severity === ALL || f.severity === severity) &&
          (agent === ALL || agentKeyOf(f) === agent) &&
          (file === null || f.file === file),
      ),
    [sorted, severity, agent, file],
  );

  const filtered = severity !== ALL || agent !== ALL || file !== null;
  const reset = () => {
    setSeverity(ALL);
    setAgent(ALL);
    clearFile();
  };

  return (
    <section aria-labelledby="findings-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <h2 id={FINDINGS_ANCHOR} className="text-muted-foreground font-mono text-xs tracking-wide uppercase">
          Findings
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={severityId}>Severity</Label>
            <Select
              value={severity}
              onValueChange={(v) => setSeverity(v as Severity | typeof ALL)}
            >
              <SelectTrigger id={severityId} className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ALL}>All severities</SelectItem>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={agentId}>Agent</Label>
            <Select
              value={agent}
              onValueChange={(v) => setAgent(v as AgentFilterKey | typeof ALL)}
            >
              <SelectTrigger id={agentId} className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ALL}>All agents</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a} value={a}>
                      {agentLabel(a)}
                    </SelectItem>
                  ))}
                </SelectGroup>
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

      {file === null ? null : (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">Showing findings on</span>
          <code className="rounded-sm border border-border bg-muted px-1 py-0.5 font-mono text-xs">
            {file}
          </code>
          <Button variant="ghost" size="sm" onClick={clearFile}>
            Show all files
          </Button>
        </div>
      )}

      <p aria-live="polite" className="text-muted-foreground mb-3 font-mono text-xs">
        {rows.length} of {sorted.length} shown · sorted by severity, then confidence
      </p>

      {rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No findings match these filters</EmptyTitle>
            <EmptyDescription>
              Widen the severity or agent filter to see the rest of this review.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" onClick={reset}>
              Clear filters
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Card className="py-0">
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
                  className="cursor-pointer has-[:focus-visible]:bg-muted"
                >
                  <TableCell>
                    <SeverityBadge severity={finding.severity} />
                  </TableCell>
                  <TableCell className="min-w-0">
                    <FilePath
                      file={finding.file}
                      line={finding.line}
                      className="text-sm"
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{finding.category}</TableCell>
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
                      className="text-left leading-snug text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
        </Card>
      )}

      <FindingSheet finding={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
