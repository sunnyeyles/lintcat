"use client";

import type { Finding } from "@pr-review/db";
import {
  Badge,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@pr-review/design";
import type { ReactNode } from "react";

import { ConfidenceMeter } from "./confidence-meter";
import { ConventionEvidence } from "./convention-evidence";
import { FilePath } from "./file-path";

import { SeverityBadge } from "@/components/ui";
import type { CommitRef } from "@/lib/github-links";

export type FindingSheetProps = {
  finding: Finding | null;
  /** The commit evidence was checked at; evidence links point into it. */
  source: CommitRef;
  onClose: () => void;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-muted-foreground text-xs tracking-wide uppercase mb-2 font-mono">{title}</h3>
      {children}
    </section>
  );
}

export function FindingSheet({ finding, source, onClose }: FindingSheetProps) {
  return (
    <Sheet open={finding !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="max-w-[min(34rem,94vw)]">
        {finding ? (
          <>
            <SheetHeader className="shrink-0">
              <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                <SeverityBadge severity={finding.severity} />
                <Badge variant="secondary">{finding.category}</Badge>
              </div>
              <SheetTitle>{finding.title}</SheetTitle>
              <SheetDescription asChild>
                <FilePath
                  file={finding.file}
                  line={finding.line}
                  className="mt-2 text-sm"
                />
              </SheetDescription>
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
              <Section title="Confidence">
                <ConfidenceMeter value={finding.confidence} className="w-full max-w-64" />
              </Section>

              <Section title="Why it matters">
                <p className="max-w-prose font-sans text-base leading-relaxed text-foreground">
                  {finding.explanation}
                </p>
              </Section>

              {finding.evidence && finding.evidence.length > 0 ? (
                <Section title="Convention seen in">
                  <ConventionEvidence evidence={finding.evidence} source={source} />
                </Section>
              ) : null}

              {finding.suggestedFix ? (
                <Section title="Suggested fix">
                  <pre className="overflow-x-auto rounded-sm border border-border bg-muted px-3.5 py-3 font-mono text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                    <code>{finding.suggestedFix}</code>
                  </pre>
                </Section>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
