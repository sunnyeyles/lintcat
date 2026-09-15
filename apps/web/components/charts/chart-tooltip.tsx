"use client";

import type { TooltipProps } from "recharts";
import type {
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";

export type ChartTooltipRow = { name: string; value: number; color: string };

export type ChartTooltipProps = TooltipProps<ValueType, NameType> & {
  formatValue?: (value: number) => string;
  formatHeading?: (label: string) => string;
  totalLabel?: string;
  /** Extra line under the rows, e.g. a cost note. */
  note?: string;
};

function toNumber(value: ValueType | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function ChartTooltip({
  active,
  payload,
  label,
  formatValue = (value) => value.toLocaleString("en-US"),
  formatHeading,
  totalLabel,
  note,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const rows: ChartTooltipRow[] = [];
  for (const item of payload) {
    const value = toNumber(item.value);
    if (value === null) continue;
    rows.push({
      name: String(item.name ?? item.dataKey ?? ""),
      value,
      color: typeof item.color === "string" ? item.color : "currentColor",
    });
  }
  if (rows.length === 0) return null;

  const heading = label === undefined || label === null ? "" : String(label);
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <div className="pointer-events-none min-w-[10rem] rounded-[3px] border border-rule bg-surface px-3 py-2 font-mono text-[0.7rem] shadow-card">
      {heading ? (
        <p className="mb-1.5 text-[0.64rem] tracking-[0.1em] text-slate-dim uppercase">
          {formatHeading ? formatHeading(heading) : heading}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1">
        {[...rows].reverse().map((row) => (
          <li key={row.name} className="flex items-center justify-between gap-4">
            <span className="flex min-w-0 items-center gap-1.5 text-slate">
              <span
                aria-hidden
                className="h-[2px] w-3 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
              />
              <span className="truncate">{row.name}</span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-ink">
              {formatValue(row.value)}
            </span>
          </li>
        ))}
      </ul>
      {totalLabel && rows.length > 1 ? (
        <p className="mt-1.5 flex items-center justify-between gap-4 border-t border-rule-soft pt-1.5 text-slate">
          <span>{totalLabel}</span>
          <span className="font-semibold tabular-nums text-ink">
            {formatValue(total)}
          </span>
        </p>
      ) : null}
      {note ? (
        <p className="mt-1.5 max-w-[16rem] text-[0.64rem] leading-relaxed text-slate-dim">
          {note}
        </p>
      ) : null}
    </div>
  );
}
