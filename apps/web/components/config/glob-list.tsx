"use client";

import { Plus, X } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui";

export type GlobListProps = {
  legend: string;
  hint: string;
  /** Singular, for the per-row accessible names: "include pattern". */
  noun: string;
  values: string[];
  placeholder: string;
  onChange: (next: string[]) => void;
};

export function GlobList({
  legend,
  hint,
  noun,
  values,
  placeholder,
  onChange,
}: GlobListProps) {
  const baseId = useId();
  const hintId = `${baseId}-hint`;

  return (
    <fieldset className="min-w-0">
      <legend className="eyebrow">{legend}</legend>
      <p id={hintId} className="mt-1.5 font-mono text-[0.7rem] leading-relaxed text-slate">
        {hint}
      </p>

      {values.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {values.map((value, index) => {
            const inputId = `${baseId}-${index}`;
            return (
              <li key={index} className="flex items-center gap-2">
                <label className="sr-only" htmlFor={inputId}>
                  {noun} {index + 1}
                </label>
                <input
                  id={inputId}
                  type="text"
                  value={value}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={placeholder}
                  aria-describedby={hintId}
                  onChange={(event) => {
                    const next = [...values];
                    next[index] = event.target.value;
                    onChange(next);
                  }}
                  className="h-8 min-w-0 flex-1 rounded-[3px] border border-rule bg-surface px-2 font-mono text-[0.72rem] text-ink transition-colors outline-none placeholder:text-slate-dim hover:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  aria-label={`Remove ${noun} ${index + 1}${value === "" ? "" : `, ${value}`}`}
                  onClick={() => onChange(values.filter((_, i) => i !== index))}
                >
                  <X aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 font-mono text-[0.7rem] text-slate-dim">
          None — every changed file passes this way.
        </p>
      )}

      <Button
        type="button"
        variant="subtle"
        size="sm"
        className="mt-3"
        onClick={() => onChange([...values, ""])}
      >
        <Plus aria-hidden />
        Add {noun}
      </Button>
    </fieldset>
  );
}
