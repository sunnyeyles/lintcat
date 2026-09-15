import { Card, CardContent, SeverityBadge } from "@/components/ui";
import type { Severity } from "@/lib/data";

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
        <h2 className="eyebrow mb-2.5 font-mono">Synthesiser summary</h2>
        <p className="max-w-[62ch] font-sans text-[1.06rem] leading-[1.62] text-ink">
          {summary}
        </p>
        {present.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-rule-soft pt-4">
            {present.map((s) => (
              <SeverityBadge key={s} severity={s} count={bySeverity[s]} />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
