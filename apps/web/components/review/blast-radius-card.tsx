import { Card, CardContent } from "@pr-review/design";
import { ChevronRight } from "@pr-review/design/icons";
import type { ReviewRecordRisk } from "@pr-review/schemas";

import { RiskBadge, SectionHeading } from "@/components/ui";
import { formatNumber } from "@/lib/format";

import { FilePath } from "./file-path";

export type BlastRadiusCardProps = {
  risk: ReviewRecordRisk;
};

function count(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

function reach({ counts, packages }: ReviewRecordRisk): string {
  if (counts.transitive === 0) return "No indexed files depend on this change.";
  const where = packages === 0 ? "" : ` in ${count(packages, "package")}`;
  const verb = counts.transitive === 1 ? "depends" : "depend";
  return `${count(counts.transitive, "file")}${where} ${verb} on this change.`;
}

const subheading = "mb-1.5 text-xs text-muted-foreground";

export function BlastRadiusCard({ risk }: BlastRadiusCardProps) {
  const detailed = risk.hubs.length > 0 || risk.factors.length > 0;

  return (
    <section aria-labelledby="blast-radius-heading" className="flex min-w-0 flex-col gap-4">
      <SectionHeading
        id="blast-radius-heading"
        title="Blast radius"
        action={<RiskBadge band={risk.band} score={risk.score} />}
      />
      <Card className="flex-1">
        <CardContent className="flex flex-col gap-4 py-5">
          <p className="font-sans text-base leading-[1.62] text-foreground">{reach(risk)}</p>

          {detailed ? (
            <details className="group">
              <summary className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-sm outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
                <ChevronRight animate="none" className="size-4 transition-transform group-open:rotate-90" />
                Where the reach comes from
              </summary>
              <div className="mt-3 flex flex-col gap-4">
                {risk.hubs.length > 0 ? (
                  <section>
                    <h3 className={subheading}>Most depended-on changed files</h3>
                    <ul className="flex flex-col gap-1 text-sm">
                      {risk.hubs.map((hub) => (
                        <li key={hub.path} className="flex items-baseline justify-between gap-3">
                          <FilePath file={hub.path} />
                          <span className="shrink-0 text-muted-foreground tabular-nums">
                            {count(hub.dependents, "dependent")}
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
              </div>
            </details>
          ) : null}

          <p className="mt-auto border-t border-border pt-3 text-xs text-muted-foreground">
            {risk.partial
              ? "Static imports only, and partial: the archive was truncated or a changed file's language is not indexed, so the true reach may be wider."
              : "Static imports only."}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
