import { Card, CardContent } from "@pr-review/design";
import type { ReviewRecordRisk } from "@pr-review/schemas";

import { SectionHeading, SeverityBadge } from "@/components/ui";
import type { Severity } from "@pr-review/db/dashboard";

import { BlastRadiusCard } from "./blast-radius-card";
import { SEVERITIES } from "./sort";

export type ReviewSummaryPanelProps = {
  summary: string;
  bySeverity: Record<Severity, number>;
  /** Null for a review stored before risk scoring, or run with the index off. */
  risk: ReviewRecordRisk | null;
};

export function ReviewSummaryPanel({ summary, bySeverity, risk }: ReviewSummaryPanelProps) {
  const present = SEVERITIES.filter((s) => bySeverity[s] > 0);

  const panel = (
    <section aria-labelledby="summary-heading" className="flex min-w-0 flex-col gap-4">
      <SectionHeading id="summary-heading" title="Summary" />
      <Card className="flex-1 border-l-2 border-l-accent">
        <CardContent className="py-5">
          <p className="max-w-prose font-sans text-base leading-[1.62] text-foreground">
            {summary}
          </p>
          {present.length > 0 ? (
            <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-border pt-4">
              {present.map((s) => (
                <SeverityBadge key={s} severity={s} count={bySeverity[s]} />
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );

  if (!risk) return panel;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-8 lg:grid-cols-2">
      {panel}
      <BlastRadiusCard risk={risk} />
    </div>
  );
}
