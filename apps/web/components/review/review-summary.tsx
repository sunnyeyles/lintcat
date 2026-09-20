import { Card, CardContent } from "@pr-review/design";

import { SeverityBadge } from "@/components/ui";
import type { Severity } from "@pr-review/db/dashboard";

import { SEVERITIES } from "./sort";

export type ReviewSummaryPanelProps = {
  summary: string;
  bySeverity: Record<Severity, number>;
};

export function ReviewSummaryPanel({ summary, bySeverity }: ReviewSummaryPanelProps) {
  const present = SEVERITIES.filter((s) => bySeverity[s] > 0);

  return (
    <Card className="border-l-2 border-l-accent">
      <CardContent className="py-5">
        <h2 className="text-muted-foreground text-xs tracking-wide uppercase mb-2.5 font-mono">Synthesiser summary</h2>
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
  );
}
