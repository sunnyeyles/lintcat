"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@pr-review/design";
import { useId } from "react";

import { ADAPTERS, detectFormat, findAdapter, type RunFile } from "@/lib/run-trace";

const AUTO = "auto";

/** Which adapter read the run, with a manual override; `undefined` means auto-detect. */
export function FormatPicker({
  files,
  value,
  used,
  onChange,
}: {
  files: readonly RunFile[];
  value: string | undefined;
  used: string | undefined;
  onChange: (format: string | undefined) => void;
}) {
  const id = useId();
  const detected = detectFormat(files);
  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor={id} className="text-muted-foreground">
        Read as
      </label>
      <Select value={value ?? AUTO} onValueChange={(next) => onChange(next === AUTO ? undefined : next)}>
        <SelectTrigger id={id} size="sm" className="w-80" aria-label="Trace format">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>Auto: {detected?.label ?? (used ? findAdapter(used)?.label : "none matched")}</SelectItem>
          {ADAPTERS.map((adapter) => (
            <SelectItem key={adapter.id} value={adapter.id}>
              {adapter.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
