"use client";

import { Label, Switch, ToggleGroup, ToggleGroupItem } from "@pr-review/design";
import { useId } from "react";

import { MAX_REACH } from "@/lib/codebase-map";

const DEPTHS = Array.from({ length: MAX_REACH }, (_, i) => i + 1);

export interface MapReachControlsProps {
  depth: number;
  reachedCount: number;
  onDepthChange: (depth: number) => void;
  /** Absent when the map holds no test files, so there is nothing to hide. */
  tests?: { shown: boolean; onShownChange: (shown: boolean) => void };
}

export function MapReachControls({ depth, reachedCount, onDepthChange, tests }: MapReachControlsProps) {
  const labelId = useId();
  const switchId = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span id={labelId} className="text-muted-foreground text-xs">
        Reach
      </span>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-labelledby={labelId}
        value={String(depth)}
        onValueChange={(value) => {
          if (value) onDepthChange(Number(value));
        }}
      >
        {DEPTHS.map((step) => (
          <ToggleGroupItem
            key={step}
            value={String(step)}
            aria-label={`${step} import step${step === 1 ? "" : "s"}`}
          >
            {step}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <span className="text-muted-foreground text-xs" role="status">
        {reachedCount} file{reachedCount === 1 ? "" : "s"} reached
      </span>
      {tests ? (
        <span className="flex items-center gap-2">
          <Switch id={switchId} size="sm" checked={tests.shown} onCheckedChange={tests.onShownChange} />
          <Label htmlFor={switchId} className="text-xs font-normal">
            Show tests
          </Label>
        </span>
      ) : null}
    </div>
  );
}
