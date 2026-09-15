"use client";

export type ChartLegendItem = {
  label: string;
  color: string;
  shape?: "rect" | "line";
  hint?: string;
};

export function ChartLegend({ items }: { items: readonly ChartLegendItem[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[0.68rem] text-slate">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={
              item.shape === "line"
                ? "h-[2px] w-3.5 shrink-0 rounded-full"
                : "size-2.5 shrink-0 rounded-[1px]"
            }
            style={{ backgroundColor: item.color }}
          />
          <span>{item.label}</span>
          {item.hint ? (
            <span className="text-slate-dim">{item.hint}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
