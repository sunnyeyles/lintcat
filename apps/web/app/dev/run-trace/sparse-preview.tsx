"use client";

import { Label, Switch } from "@pr-review/design";
import { useState } from "react";

import { SPARSE_TRACE } from "@/app/dev/run-trace/sparse-trace";
import { TraceView } from "@/app/dev/run-trace/trace-view";

// Temporary, development only: shows how the bots degrade on a source with almost no data.
export function SparsePreview() {
  const [on, setOn] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Switch id="sparse-preview" checked={on} onCheckedChange={setOn} />
        <Label htmlFor="sparse-preview" className="text-muted-foreground text-sm">
          Dev: show the sparse fixture
        </Label>
      </div>
      {on ? <TraceView trace={SPARSE_TRACE} /> : null}
    </div>
  );
}
