import { AgentChip } from "@/components/ui";
import { costOf, type AgentRun } from "@/lib/data";
import { formatDuration, formatTokens, formatUsd } from "@/lib/format";

function tokenTotal(run: AgentRun): number {
  return (
    run.inputTokens +
    run.cacheCreationInputTokens +
    run.cacheReadInputTokens +
    run.outputTokens
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-caption tracking-caps text-slate uppercase">
        {label}
      </dt>
      <dd className="tabular-nums text-slate">{value}</dd>
    </div>
  );
}

export function AgentRunStrip({ runs }: { runs: readonly AgentRun[] }) {
  const ordered = [...runs].sort(
    (a, b) => b.findingCount - a.findingCount || a.agent.localeCompare(b.agent),
  );

  return (
    <section aria-labelledby="agent-strip-heading">
      <h2 id="agent-strip-heading" className="eyebrow mb-2.5 font-mono">
        Agents on this head
      </h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-px border border-rule bg-rule">
        {ordered.map((run) => (
          <div
            key={run.id}
            className="flex min-w-0 flex-col gap-2.5 bg-surface px-3.5 py-3"
          >
            <AgentChip agent={run.agent} className="self-start" />
            <p className="flex items-baseline gap-1.5">
              <span className="font-mono text-h2 leading-none font-semibold tabular-nums text-ink">
                {run.findingCount}
              </span>
              <span className="font-mono text-caption tracking-caps text-slate uppercase">
                {run.findingCount === 1 ? "finding" : "findings"}
              </span>
            </p>
            <dl className="flex flex-col gap-0.5 border-t border-rule-soft pt-2 font-mono text-caption">
              <Metric label="time" value={formatDuration(run.durationMs)} />
              <Metric label="tokens" value={formatTokens(tokenTotal(run))} />
              <Metric label="cost" value={formatUsd(costOf(run))} />
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
