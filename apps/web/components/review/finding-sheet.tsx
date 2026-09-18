"use client";

import type { Finding } from "@pr-review/db";
import type { ReactNode } from "react";

import {
  Badge,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SeverityBadge,
} from "@/components/ui";

import { ConfidenceMeter } from "./confidence-meter";
import { FilePath } from "./file-path";

export type FindingSheetProps = {
  finding: Finding | null;
  onClose: () => void;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="eyebrow mb-2 font-mono">{title}</h3>
      {children}
    </section>
  );
}

export function FindingSheet({ finding, onClose }: FindingSheetProps) {
  return (
    <Sheet open={finding !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="max-w-[min(34rem,94vw)]">
        {finding ? (
          <>
            <SheetHeader className="shrink-0">
              <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                <SeverityBadge severity={finding.severity} />
                <Badge variant="soft">{finding.category}</Badge>
              </div>
              <SheetTitle>{finding.title}</SheetTitle>
              <SheetDescription asChild>
                <FilePath
                  file={finding.file}
                  line={finding.line}
                  className="mt-2 text-[0.72rem]"
                />
              </SheetDescription>
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
              <Section title="Confidence">
                <ConfidenceMeter value={finding.confidence} className="w-full max-w-64" />
              </Section>

              <Section title="Why it matters">
                <p className="max-w-[58ch] font-sans text-[0.98rem] leading-relaxed text-ink">
                  {finding.explanation}
                </p>
              </Section>

              {finding.suggestedFix ? (
                <Section title="Suggested fix">
                  <pre className="overflow-x-auto rounded-[3px] border border-rule bg-surface-2 px-3.5 py-3 font-mono text-[0.72rem] leading-relaxed whitespace-pre-wrap text-ink">
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
