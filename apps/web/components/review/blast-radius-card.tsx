import { Card, CardContent } from "@pr-review/design";
import type { ReviewRecordRisk } from "@pr-review/schemas";

import { RiskBadge } from "@/components/ui";
import { countLabel, plural } from "@/lib/format";

import { FilePath } from "./file-path";

export type BlastRadiusCardProps = {
  risk: ReviewRecordRisk;
};

function reach({ counts, packages }: ReviewRecordRisk): string {
  if (counts.transitive === 0) return "No indexed files depend on this change.";
  const where = packages === 0 ? "" : ` in ${countLabel(packages, "package")}`;
  const verb = plural(counts.transitive, "depends", "depend");
  return `${countLabel(counts.transitive, "file")}${where} ${verb} on this change.`;
}

const subheading = "mb-1.5 text-xs text-muted-foreground";

export function BlastRadiusCard({ risk }: BlastRadiusCardProps) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="eyebrow font-mono">
            Blast radius
          </h2>
          <RiskBadge band={risk.band} score={risk.score} />
        </div>

        <p className="font-sans text-base leading-[1.62] text-foreground">{reach(risk)}</p>

        {risk.hubs.length > 0 ? (
          <section>
            <h3 className={subheading}>Most depended-on changed files</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {risk.hubs.map((hub) => (
                <li key={hub.path} className="flex items-baseline justify-between gap-3">
                  <FilePath file={hub.path} />
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {countLabel(hub.dependents, "dependent")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {risk.factors.length > 0 ? (
          <section>
            <h3 className={subheading}>How the score adds up</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {risk.factors.map((factor) => (
                <li key={factor.label} className="flex items-baseline justify-between gap-3">
                  <span className="text-foreground">{factor.label}</span>
                  <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                    +{factor.points}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          {risk.partial
            ? "Static imports only, and partial: the archive was truncated or a changed file's language is not indexed, so the true reach may be wider."
            : "Static imports only."}
        </p>
      </CardContent>
    </Card>
  );
}
